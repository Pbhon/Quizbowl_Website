import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { documentId } from "./history";
import { readableShare } from "./deck-sharing";
import { PracticeError } from "./practice-persistence";
import { timestampISO } from "./dashboard";
import { buildStatistics } from "@/lib/statistics";
export async function recordStudyReview(
  db: Firestore,
  uid: string,
  body: Record<string, unknown>,
) {
  const requestId = documentId(body.requestId),
    cardId = documentId(body.cardId);
  if (!/^[a-f0-9-]{36}$/i.test(requestId))
    throw new PracticeError("Invalid review identifier.", 400);
  const receipt = db.doc(`users/${uid}/studyReviews/${requestId}`);
  return db.runTransaction(async (tx) => {
    const deck = body.sharedId
      ? await readableShare(db, tx, uid, body.sharedId)
      : await tx.get(db.doc(`users/${uid}/decks/${documentId(body.deckId)}`));
    if (
      !deck.exists ||
      !(await tx.get(deck.ref.collection("questions").doc(cardId))).exists
    )
      throw new PracticeError("Study card is unavailable.", 404);
    const prior = await tx.get(receipt);
    if (prior.exists) {
      if (
        prior.data()?.deckPath !== deck.ref.path ||
        prior.data()?.cardId !== cardId
      )
        throw new PracticeError(
          "This review identifier was already used.",
          409,
        );
      return { saved: true };
    }
    tx.create(receipt, {
      deckPath: deck.ref.path,
      cardId,
      completedAt: FieldValue.serverTimestamp(),
    });
    return { saved: true };
  });
}
export async function loadStudyActivity(
  db: Firestore,
  uid: string,
  timeZone: string,
  now = new Date(),
) {
  const [decks, reviews] = await Promise.all([
    db.collection(`users/${uid}/decks`).get(),
    db.collection(`users/${uid}/studyReviews`).get(),
  ]);
  const cardCounts = await Promise.all(
    decks.docs.map((doc) =>
      doc.ref
        .collection("questions")
        .count()
        .get()
        .then((snapshot) => snapshot.data().count),
    ),
  );
  const dates = reviews.docs
    .map((doc) => timestampISO(doc.data().completedAt))
    .filter(
      (value): value is string => Boolean(value) && new Date(value!) <= now,
    );
  const reviewStats = buildStatistics(
    dates.map((date, i) => ({
      sessionId: String(i),
      questionIndex: 0,
      part: 0,
      outcome: "skipped",
      completedAt: date,
      question: {
        category: "Review",
        subcategory: "Flashcards",
        difficulty: 0,
      },
    })),
    now,
    timeZone,
  );
  const changes = decks.docs
    .map((doc) => timestampISO(doc.data().updatedAt))
    .filter(
      (value): value is string => Boolean(value) && new Date(value!) <= now,
    );
  return {
    decks: decks.size,
    savedCards: cardCounts.reduce((sum, count) => sum + count, 0),
    lastDeckChange: changes.sort().at(-1) || null,
    reviews: dates.length,
    lastReviewAt: dates.sort().at(-1) || null,
    today: reviewStats.current.daily.questions,
    thisWeek: reviewStats.current.weekly.questions,
    thisMonth: reviewStats.current.monthly.questions,
  };
}

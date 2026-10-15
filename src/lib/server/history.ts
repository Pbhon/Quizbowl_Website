import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { subjects, type Question } from "@/lib/practice";
import {
  matchesHistory,
  type HistoryAttempt,
  type HistoryFilters,
} from "@/lib/history";
import { PracticeError } from "./practice-persistence";
import { timestampISO } from "./dashboard";
import { requireDeckEditor } from "./deck-permissions";

export function documentId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value))
    throw new PracticeError("Invalid record identifier.", 400);
  return value;
}
export function parseHistoryFilters(params: URLSearchParams): HistoryFilters {
  const filters = {
    category: params.get("category") || "",
    subcategory: params.get("subcategory") || "",
    difficulty: params.get("difficulty") || "",
    outcome: params.get("outcome") || "",
  };
  if (
    (filters.category && !Object.hasOwn(subjects, filters.category)) ||
    (filters.subcategory &&
      !(
        filters.category
          ? subjects[filters.category]
          : Object.values(subjects).flat()
      ).includes(filters.subcategory)) ||
    (filters.difficulty && !/^(?:[0-9]|10)$/.test(filters.difficulty)) ||
    (filters.outcome &&
      !["correct", "incorrect", "skipped", "prompt"].includes(filters.outcome))
  )
    throw new PracticeError("Invalid history filters.", 400);
  return filters;
}
export async function loadHistory(
  db: Firestore,
  uid: string,
  params: URLSearchParams,
) {
  const filters = parseHistoryFilters(params);
  const collection = db.collection(`users/${uid}/attempts`);
  let query = collection.orderBy("createdAt", "desc");
  const cursor = params.get("cursor");
  if (cursor) {
    const snapshot = await collection.doc(documentId(cursor)).get();
    if (!snapshot.exists)
      throw new PracticeError(
        "History position no longer exists. Refresh your history.",
        400,
      );
    query = query.startAfter(snapshot);
  }
  const attempts: HistoryAttempt[] = [];
  while (attempts.length < 31) {
    const page = await query.limit(100).get();
    for (const doc of page.docs) {
      const data = doc.data();
      const attempt = {
        id: doc.id,
        question: data.question,
        part: data.part,
        outcome: data.outcome,
        submittedAnswer: data.submittedAnswer || "",
        createdAt: timestampISO(data.createdAt),
        submissions: data.submissions || [],
      } as HistoryAttempt;
      if (matchesHistory(attempt, filters)) attempts.push(attempt);
      if (attempts.length === 31) break;
    }
    if (page.size < 100 || attempts.length === 31) break;
    query = query.startAfter(page.docs[page.docs.length - 1]);
  }
  return {
    attempts: attempts.slice(0, 30),
    nextCursor: attempts.length > 30 ? attempts[29].id : null,
  };
}
export async function historyQuestion(
  db: Firestore,
  uid: string,
  id: unknown,
  missedOnly = false,
): Promise<Question> {
  const attempt = await db.doc(`users/${uid}/attempts/${documentId(id)}`).get();
  if (!attempt.exists)
    throw new PracticeError("Question attempt not found.", 404);
  const data = attempt.data()!;
  if (missedOnly && data.outcome !== "incorrect")
    throw new PracticeError("Choose an incorrect response to retry.", 400);
  return data.question as Question;
}
export async function loadDecks(db: Firestore, uid: string) {
  const decks = await db
    .collection(`users/${uid}/decks`)
    .orderBy("createdAt", "desc")
    .get();
  return Promise.all(
    decks.docs.map(async (deck) => {
      const cards = await deck.ref.collection("questions").get();
      return {
        id: deck.id,
        name: deck.data().name as string,
        questions: cards.docs.map((doc) => doc.data().question as Question),
      };
    }),
  );
}
export async function saveHistoryToDeck(
  db: Firestore,
  uid: string,
  body: Record<string, unknown>,
  verified = false,
) {
  const question = await historyQuestion(db, uid, body.attemptId);
  const decks = db.collection(`users/${uid}/decks`);
  const isNew = body.deckId === undefined;
  if (
    isNew &&
    (typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.trim().length > 80)
  )
    throw new PracticeError("Enter a deck name of 1–80 characters.", 400);
  const deck = isNew ? decks.doc() : decks.doc(documentId(body.deckId));
  const card = deck.collection("questions").doc();
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(deck);
    if (!isNew && !existing.exists)
      throw new PracticeError("Study deck not found.", 404);
    if (!isNew)
      await requireDeckEditor(db, tx, uid, existing.data()!, verified);
    if (isNew)
      tx.create(deck, {
        name: (body.name as string).trim(),
        createdAt: FieldValue.serverTimestamp(),
      });
    // Save the original full question, including every bonus part and judging answer line.
    tx.set(card, {
      question,
      savedAt: FieldValue.serverTimestamp(),
    });
    if (!isNew) tx.update(deck, { updatedAt: FieldValue.serverTimestamp() });
  });
  return { deckId: deck.id };
}

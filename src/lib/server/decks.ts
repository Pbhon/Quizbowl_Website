import "server-only";
import { createHash } from "node:crypto";
import {
  FieldValue,
  type Firestore,
  type DocumentSnapshot,
  type QuerySnapshot,
} from "firebase-admin/firestore";
import type { Question } from "@/lib/practice";
import { savedIdentifiers, type StudyDeck } from "@/lib/decks";
import { documentId, historyQuestion } from "./history";
import { PracticeError } from "./practice-persistence";
import {
  audienceFields,
  readableShare,
  shareRef,
  writeAudience,
} from "./deck-sharing";
import { siteTeam } from "./site-team";

const stamp = () => FieldValue.serverTimestamp();
export function deckText(value: unknown, max: number, required = false) {
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim())
  )
    throw new PracticeError(
      `Enter ${required ? "1–" : "up to "}${max} characters.`,
      400,
    );
  return value.trim();
}
export function deckTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20)
    throw new PracticeError("Use up to 20 topic tags.", 400);
  return [...new Set(value.map((tag) => deckText(tag, 40, true)))];
}
const deckRef = (db: Firestore, uid: string, id: unknown) =>
  db.doc(`users/${uid}/decks/${documentId(id)}`);
export async function ensureStarred(db: Firestore, uid: string) {
  const ref = deckRef(db, uid, "starred");
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(ref)).exists)
      tx.create(ref, {
        name: "Starred Questions",
        description: "Questions starred from practice.",
        tags: [],
        visibility: "private",
        teamId: null,
        createdAt: stamp(),
        updatedAt: stamp(),
      });
  });
}
export async function studyDecks(db: Firestore, uid: string) {
  await ensureStarred(db, uid);
  const decks = await db
    .collection(`users/${uid}/decks`)
    .orderBy("createdAt", "desc")
    .get();
  const owned = await Promise.all(
    decks.docs.map(async (doc) => {
      return serializeDeck(
        doc,
        await doc.ref.collection("questions").get(),
        true,
      );
    }),
  );
  const teamId = siteTeam().id;
  if (!(await db.doc(`teams/${teamId}/members/${uid}`).get()).exists)
    return owned;
  const directory = await db.collection(`teams/${teamId}/sharedDecks`).get();
  const shared = await Promise.all(
    directory.docs
      .filter((doc) => doc.data().ownerUid !== uid)
      .map(async (index) => {
        try {
          return await db.runTransaction(async (tx) => {
            const doc = await readableShare(db, tx, uid, index.id);
            const cards = await tx.get(doc.ref.collection("questions"));
            return serializeDeck(doc, cards, false, index.id);
          });
        } catch (error) {
          // Revocation, removal, and stale directory entries expose no deck data.
          if (error instanceof PracticeError && error.status === 404)
            return null;
          throw error;
        }
      }),
  );
  return [...owned, ...shared.filter((deck) => deck !== null)];
}
export async function exportDeck(
  db: Firestore,
  uid: string,
  deckId: unknown,
  sharedId?: unknown,
) {
  return db.runTransaction(async (tx) => {
    const doc =
      sharedId !== undefined
        ? await readableShare(db, tx, uid, sharedId)
        : await tx.get(deckRef(db, uid, deckId));
    if (!doc.exists) throw new PracticeError("Study deck not found.", 404);
    const cards = await tx.get(doc.ref.collection("questions").limit(5001));
    if (cards.size > 5000)
      throw new PracticeError(
        "Export decks with up to 5000 saved questions.",
        413,
      );
    return {
      deck: serializeDeck(doc, cards, sharedId === undefined),
      key: doc.ref.path,
    };
  });
}
function serializeDeck(
  doc: DocumentSnapshot,
  snapshot: QuerySnapshot,
  canEdit: boolean,
  sharedId?: string,
): StudyDeck {
  const data = doc.data()!;
  const cards = snapshot.docs.map((card) => {
    const saved = card.data();
    return {
      id: card.id,
      question: saved.question as Question,
      originalQuestion: (saved.originalQuestion || saved.question) as Question,
      tags: saved.tags || [],
      notes: saved.notes || "",
      identifiers: savedIdentifiers(
        saved.identifiers,
        saved.originalQuestion || saved.question,
      ),
    };
  });
  return {
    id: sharedId ? `shared-${sharedId}` : doc.id,
    teacherCurated: data.curatedBy === doc.ref.parent.parent?.id,
    canEdit,
    sharedId: sharedId || null,
    visibility: data.visibility === "team" ? "team" : "private",
    teamName:
      data.teamId === siteTeam().id ? siteTeam().name : "another school",
    name: data.name,
    description: data.description || "",
    tags: data.tags || [],
    cards,
    questions: cards.map((card) => card.question),
  };
}
export async function mutateDeck(
  db: Firestore,
  uid: string,
  body: Record<string, unknown>,
) {
  if (body.action === "create") {
    const ref = db.collection(`users/${uid}/decks`).doc();
    const data = {
      ...(body.teacherCurated === true ? { curatedBy: uid } : {}),
      name: deckText(body.name, 80, true),
      description: deckText(body.description ?? "", 1000),
      tags: deckTags(body.tags ?? []),
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    await db.runTransaction(async (tx) => {
      if (body.teacherCurated === true) {
        const staff = (await tx.get(db.doc(`staff/${uid}`))).data();
        if (
          !staff ||
          staff.teamId !== siteTeam().id ||
          !["teacher", "admin"].includes(staff.role)
        )
          throw new PracticeError("Staff access required.", 403);
      }
      const audience = await audienceFields(
        db,
        tx,
        uid,
        ref.id,
        body.visibility,
      );
      tx.create(ref, { ...data, ...audience });
      writeAudience(db, tx, uid, ref.id, audience);
    });
    return { deckId: ref.id };
  }
  if (body.action === "save" || body.action === "star") {
    let questions: Question[] = [];
    if (body.attemptId !== undefined)
      questions = [await historyQuestion(db, uid, body.attemptId)];
    else if (body.sessionId !== undefined) {
      const session = db.doc(
        `users/${uid}/practiceSessions/${documentId(body.sessionId)}`,
      );
      if (!(await session.get()).exists)
        throw new PracticeError("Practice session not found.", 404);
      const indexes = body.questionIndexes;
      if (
        !Array.isArray(indexes) ||
        !indexes.length ||
        indexes.length > 50 ||
        indexes.some((n) => !Number.isInteger(n) || n < 0 || n >= 50)
      )
        throw new PracticeError("Choose 1–50 session questions.", 400);
      questions = await Promise.all(
        [...new Set(indexes)].map(async (index) => {
          const doc = await session
            .collection("questions")
            .doc(String(index))
            .get();
          if (!doc.exists)
            throw new PracticeError("Question not found in your session.", 404);
          return doc.data() as Question;
        }),
      );
    } else if (body.sourceDeckId !== undefined) {
      const card = await deckRef(db, uid, body.sourceDeckId)
        .collection("questions")
        .doc(documentId(body.cardId))
        .get();
      if (!card.exists) throw new PracticeError("Saved card not found.", 404);
      questions = [card.data()!.originalQuestion || card.data()!.question];
    } else if (body.sourceSharedId === undefined)
      throw new PracticeError(
        "Choose a saved attempt or practice question.",
        400,
      );
    if (body.action === "star") await ensureStarred(db, uid);
    const ids = body.action === "star" ? ["starred"] : body.deckIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 8)
      throw new PracticeError("Choose 1–8 decks.", 400);
    const refs = [...new Set(ids)].map((id) => deckRef(db, uid, id));
    await db.runTransaction(async (tx) => {
      if (body.sourceSharedId !== undefined) {
        const source = await readableShare(db, tx, uid, body.sourceSharedId);
        const card = await tx.get(
          source.ref.collection("questions").doc(documentId(body.cardId)),
        );
        if (!card.exists) throw new PracticeError("Saved card not found.", 404);
        questions = [card.data()!.originalQuestion || card.data()!.question];
      }
      const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
      if (snapshots.some((doc) => !doc.exists))
        throw new PracticeError("Study deck not found.", 404);
      const cards = refs.flatMap((ref) =>
        questions.map((question) => ({
          ref: ref
            .collection("questions")
            .doc(
              createHash("sha256")
                .update(`${question.type}:${question.id}`)
                .digest("hex"),
            ),
          question,
        })),
      );
      const existing = await Promise.all(cards.map((card) => tx.get(card.ref)));
      cards.forEach((card, index) => {
        if (!existing[index].exists)
          tx.create(card.ref, {
            question: card.question,
            originalQuestion: card.question,
            tags: [],
            notes: "",
            savedAt: stamp(),
          });
      });
      refs.forEach((ref) => tx.update(ref, { updatedAt: stamp() }));
    });
    return { deckIds: refs.map((ref) => ref.id) };
  }
  const ref = deckRef(db, uid, body.deckId);
  if (body.action === "delete") {
    if (ref.id === "starred")
      throw new PracticeError(
        "Keep the default Starred Questions deck; remove its cards instead.",
        400,
      );
    // Remove the parent and sharing pointer atomically. Concurrent saves conflict
    // with that parent deletion; recursive cleanup then removes its cards.
    await db.runTransaction(async (tx) => {
      const deck = await tx.get(ref);
      if (!deck.exists) throw new PracticeError("Study deck not found.", 404);
      if (deck.data()!.teamId)
        tx.delete(shareRef(db, deck.data()!.teamId, uid, ref.id));
      tx.delete(ref);
    });
    await db.recursiveDelete(ref.collection("questions"));
    return { deleted: true };
  }
  return db.runTransaction(async (tx) => {
    const deck = await tx.get(ref);
    if (!deck.exists) throw new PracticeError("Study deck not found.", 404);
    if (body.action === "shareTeacher") {
      const staff = (await tx.get(db.doc(`staff/${uid}`))).data();
      if (
        deck.data()!.curatedBy !== uid ||
        !staff ||
        staff.teamId !== siteTeam().id ||
        !["teacher", "admin"].includes(staff.role)
      )
        throw new PracticeError(
          "Only the current staff creator can share this teacher deck.",
          403,
        );
      const audience = await audienceFields(
        db,
        tx,
        uid,
        ref.id,
        body.visibility,
        deck.data()!,
      );
      tx.update(ref, { ...audience, updatedAt: stamp() });
      writeAudience(db, tx, uid, ref.id, audience, deck.data()!);
      return { deckId: ref.id };
    }
    if (body.action === "update") {
      const audience = await audienceFields(
        db,
        tx,
        uid,
        ref.id,
        body.visibility,
        deck.data()!,
      );
      tx.update(ref, {
        ...audience,
        name:
          ref.id === "starred"
            ? "Starred Questions"
            : deckText(body.name, 80, true),
        description: deckText(body.description ?? "", 1000),
        tags: deckTags(body.tags ?? []),
        updatedAt: stamp(),
      });
      writeAudience(db, tx, uid, ref.id, audience, deck.data()!);
    } else if (body.action === "editCard" || body.action === "removeCard") {
      const cardRef = ref.collection("questions").doc(documentId(body.cardId));
      const card = await tx.get(cardRef);
      if (!card.exists) throw new PracticeError("Saved card not found.", 404);
      if (body.action === "removeCard") tx.delete(cardRef);
      else {
        const data = card.data()!;
        const original = (data.originalQuestion || data.question) as Question;
        const parts = body.parts;
        const lines = body.answerLines;
        if (
          !Array.isArray(parts) ||
          !Array.isArray(lines) ||
          parts.length !== original.parts.length ||
          lines.length !== parts.length
        )
          throw new PracticeError(
            "Keep every original question part and its answer.",
            400,
          );
        tx.update(cardRef, {
          originalQuestion: original,
          question: {
            ...original,
            leadin: deckText(body.leadin ?? original.leadin, 20000),
            parts: parts.map((part) => deckText(part, 20000, true)),
            answerLines: lines.map((line) => deckText(line, 5000, true)),
          },
          tags: deckTags(body.tags ?? []),
          notes: deckText(body.notes ?? "", 5000),
          updatedAt: stamp(),
        });
      }
      tx.update(ref, { updatedAt: stamp() });
    } else throw new PracticeError("Invalid deck action.", 400);
    return { deckId: ref.id };
  });
}

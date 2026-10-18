import "server-only";
import { randomUUID } from "node:crypto";
import {
  FieldValue,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import type { Question } from "@/lib/practice";
import { savedIdentifiers } from "@/lib/decks";
import { clueCacheKey, clueVersion, validateClues } from "./clue-cache";
import { PracticeError } from "./practice-persistence";
import { gemini } from "./gemini";
import { documentId } from "./history";
import { requireDeckEditor } from "./deck-permissions";
import { generationState } from "@/lib/clues";
import { GenerationError } from "./generation-error";

export async function savedClueStatus(
  db: Firestore,
  uid: string,
  deckId: unknown,
  cardId: unknown,
  verified: boolean,
) {
  if (!verified)
    throw new PracticeError("Verify your email before generating clues.", 403);
  const deck = db.doc(`users/${uid}/decks/${documentId(deckId)}`);
  const card = deck.collection("questions").doc(documentId(cardId));
  return db.runTransaction(async (tx) => {
    const [parent, saved] = await tx.getAll(deck, card);
    if (!parent.exists || !saved.exists)
      throw new PracticeError("Saved card not found.", 404);
    await requireDeckEditor(db, tx, uid, parent.data()!, verified);
    const data = saved.data()!;
    const question = (data.originalQuestion || data.question) as Question;
    const model = process.env.GEMINI_MODEL;
    const configured = Boolean(
      process.env.GEMINI_GENERATION_ENABLED === "true" &&
      process.env.GEMINI_API_KEY &&
      model &&
      /^[a-zA-Z0-9.-]{1,80}$/.test(model),
    );
    const cached = model
      ? (
          await tx.get(db.doc(`aiClueCache/${clueCacheKey(question, model)}`))
        ).data()
      : undefined;
    return {
      generation: generationState(
        cached ||
          data.generation ||
          (data.identifiers ? { status: "completed" } : undefined),
      ),
      configured,
    };
  });
}

export async function generateSavedClues(
  db: Firestore,
  uid: string,
  deckId: unknown,
  cardId: unknown,
  verified: boolean,
) {
  if (!verified)
    throw new PracticeError("Verify your email before generating clues.", 403);
  const model = process.env.GEMINI_MODEL;
  const key = process.env.GEMINI_API_KEY;
  if (
    process.env.GEMINI_GENERATION_ENABLED !== "true" ||
    !key ||
    !model ||
    !/^[a-zA-Z0-9.-]{1,80}$/.test(model)
  )
    throw new PracticeError("Clue generation is not configured.", 503);
  const deck = db.doc(`users/${uid}/decks/${documentId(deckId)}`);
  const card = deck.collection("questions").doc(documentId(cardId));
  async function source(tx: Transaction) {
    const [parent, saved] = await tx.getAll(deck, card);
    if (!parent.exists || !saved.exists)
      throw new PracticeError("Saved card not found.", 404);
    await requireDeckEditor(db, tx, uid, parent.data()!, verified);
    const data = saved.data()!;
    const question = (data.originalQuestion || data.question) as Question;
    if (
      !question ||
      !Array.isArray(question.parts) ||
      !Array.isArray(question.answerLines) ||
      question.parts.length !== question.answerLines.length ||
      JSON.stringify(question).length > 100000
    )
      throw new PracticeError(
        "This saved question cannot generate clues.",
        400,
      );
    return question;
  }
  const question = await db.runTransaction(source);
  const cacheKey = clueCacheKey(question, model);
  const cache = db.doc(`aiClueCache/${cacheKey}`);
  const now = Date.now(),
    token = randomUUID();
  const day = new Date(now).toISOString().slice(0, 10);
  const quota = db.doc(`users/${uid}/aiUsage/${day}`);
  const global = db.doc(`aiGenerationUsage/${day}`);
  const minute = db.doc(`aiGenerationUsage/minute-${Math.floor(now / 60000)}`);
  const ready = await db.runTransaction(async (tx) => {
    const live = await source(tx);
    if (clueCacheKey(live, model) !== cacheKey)
      throw new PracticeError("Saved question changed. Retry.", 409);
    const [cached, used, all, burst] = await tx.getAll(
      cache,
      quota,
      global,
      minute,
    );
    const data = cached.data();
    if (data?.status === "completed") {
      try {
        return validateClues(data.identifiers, question);
      } catch {
        // An obsolete or corrupt entry is a miss, never delivered to a student.
      }
    }
    if (
      (data?.status === "generating" && data.leaseUntil > now) ||
      data?.retryAt > now
    )
      throw new GenerationError(
        "Clues are being generated or cooling down. Retry in a minute.",
        409,
        Math.max(data?.leaseUntil || 0, data?.retryAt || 0),
        generationState(data),
      );
    if (
      (used.data()?.count || 0) >= 20 ||
      (all.data()?.count || 0) >= 200 ||
      (burst.data()?.count || 0) >= 10
    )
      throw new PracticeError(
        "The generation limit has been reached. Try later.",
        429,
      );
    for (const ref of [quota, global, minute])
      tx.set(
        ref,
        {
          count: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          expiresAt: new Date(now + 32 * 86400000),
        },
        { merge: true },
      );
    tx.set(cache, {
      status: "generating",
      token,
      leaseUntil: now + 90000,
      model,
      version: clueVersion,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(card, {
      generation: { status: "generating", token, leaseUntil: now + 90000 },
    });
    return null;
  });
  let identifiers = ready;
  if (!identifiers) {
    try {
      identifiers = await gemini(question, model, key);
      const generated = identifiers;
      await db.runTransaction(async (tx) => {
        const current = await tx.get(cache);
        if (
          current.data()?.token !== token ||
          current.data()!.leaseUntil <= Date.now()
        )
          throw new PracticeError("Generation expired. Retry.", 409);
        tx.set(cache, {
          status: "completed",
          model,
          version: clueVersion,
          identifiers: generated,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (error) {
      const retryAt =
        error instanceof GenerationError ? error.retryAt : Date.now() + 60000;
      await db.runTransaction(async (tx) => {
        const [cached, currentCard] = await tx.getAll(cache, card);
        if (cached.data()?.token === token) {
          tx.set(cache, {
            status: "failed",
            model,
            version: clueVersion,
            retryAt,
            updatedAt: FieldValue.serverTimestamp(),
          });
          if (
            currentCard.exists &&
            currentCard.data()?.generation?.token === token
          )
            tx.update(card, {
              generation: { status: "failed", retryAt },
            });
        }
      });
      if (error instanceof PracticeError) throw error;
      throw new GenerationError(
        "Generation failed validation or timed out. Retry in a minute.",
        502,
        retryAt,
      );
    }
  }
  const saved = identifiers;
  const delivered = await db.runTransaction(async (tx) => {
    const live = await source(tx);
    if (clueCacheKey(live, model) !== cacheKey)
      throw new PracticeError("Saved question changed. Retry.", 409);
    const current = (await tx.get(card)).data()!;
    if (current.identifiersEdited === true) {
      tx.update(card, { generation: { status: "completed" } });
      return savedIdentifiers(current.identifiers, live);
    }
    tx.update(card, {
      identifiers: saved,
      clueCacheKey: cacheKey,
      generatedAt: FieldValue.serverTimestamp(),
      generation: { status: "completed" },
    });
    tx.update(deck, { updatedAt: FieldValue.serverTimestamp() });
    return saved;
  });
  return { identifiers: delivered, cached: Boolean(ready) };
}

import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { Outcome } from "@/lib/practice";

/** UTC storage buckets; the existing dashboard still derives local-time activity. */
export async function prepareDailyStatistics(
  db: Firestore,
  tx: Transaction,
  uid: string,
  sessionId: string,
  questionIndex: number,
  outcome: Outcome | "prompt",
  now = new Date(),
) {
  if (outcome === "prompt") return () => {};
  const day = now.toISOString().slice(0, 10);
  const ref = db.doc(`users/${uid}/dailyStatistics/${day}`);
  const marker = ref
    .collection("questions")
    .doc(`${sessionId}_${questionIndex}`);
  const seen = await tx.get(marker);
  return () => {
    tx.set(
      ref,
      {
        day,
        timeZone: "UTC",
        schemaVersion: 1,
        responses: FieldValue.increment(1),
        [outcome]: FieldValue.increment(1),
        questions: FieldValue.increment(seen.exists ? 0 : 1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (!seen.exists)
      tx.create(marker, { createdAt: FieldValue.serverTimestamp() });
  };
}

import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import type { GenerationUsage } from "@/lib/clues";
import { generationLimits } from "./generation-limits";

export function dailyGenerationUsage(
  used: number,
  now = Date.now(),
): GenerationUsage {
  const day = new Date(now).toISOString().slice(0, 10);
  const limit = generationLimits().student;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: Date.parse(`${day}T00:00:00Z`) + 86400000,
  };
}

/** The caller supplies the authenticated UID, never a query-selected account. */
export async function readGenerationUsage(db: Firestore, uid: string) {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const [saved] = await db.getAll(db.doc(`users/${uid}/aiUsage/${day}`));
  return dailyGenerationUsage(saved.data()?.count || 0, now);
}

import "server-only";
import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { documentId } from "./history";
import { PracticeError } from "./practice-persistence";
import { siteTeam } from "./site-team";

export function deckVisibility(value: unknown): "private" | "team" {
  if (value !== "private" && value !== "team")
    throw new PracticeError("Choose private or team-shared visibility.", 400);
  return value;
}
export const shareId = (uid: string, deckId: string) =>
  createHash("sha256").update(`${uid}/${deckId}`).digest("hex");
export function shareRef(
  db: Firestore,
  teamId: string,
  uid: string,
  deckId: string,
) {
  return db.doc(
    `teams/${documentId(teamId)}/sharedDecks/${shareId(uid, deckId)}`,
  );
}

// Called before transaction writes. Ownership comes from the authenticated UID;
// only the configured school can be selected as a new sharing audience.
export async function audienceFields(
  db: Firestore,
  tx: Transaction,
  uid: string,
  deckId: string,
  requested: unknown,
  previous: { visibility?: string; teamId?: string } = {},
) {
  const visibility = deckVisibility(
    requested === undefined ? (previous.visibility ?? "private") : requested,
  );
  if (deckId === "starred" && visibility !== "private")
    throw new PracticeError(
      "Starred Questions stays private. Copy cards to a team-shared deck instead.",
      400,
    );
  let teamId: string | null = null;
  if (visibility === "team") {
    teamId =
      previous.visibility === "team" && previous.teamId
        ? previous.teamId
        : siteTeam().id;
    if (previous.visibility !== "team") {
      if (!(await tx.get(db.doc(`teams/${teamId}/members/${uid}`))).exists)
        throw new PracticeError("Join this school before sharing a deck.", 403);
    }
  }
  return { visibility, teamId };
}
export function writeAudience(
  db: Firestore,
  tx: Transaction,
  uid: string,
  deckId: string,
  next: { visibility: "private" | "team"; teamId: string | null },
  previous: { teamId?: string } = {},
) {
  if (previous.teamId && previous.teamId !== next.teamId)
    tx.delete(shareRef(db, previous.teamId, uid, deckId));
  if (next.visibility === "team" && next.teamId)
    tx.set(shareRef(db, next.teamId, uid, deckId), { ownerUid: uid, deckId });
}

// A share directory entry is only a pointer, never authorization on its own.
// Membership, pointer, live visibility and card reads share one transaction.
export async function readableShare(
  db: Firestore,
  tx: Transaction,
  uid: string,
  id: unknown,
) {
  const teamId = siteTeam().id;
  const [member, index] = await Promise.all([
    tx.get(db.doc(`teams/${teamId}/members/${uid}`)),
    tx.get(db.doc(`teams/${teamId}/sharedDecks/${documentId(id)}`)),
  ]);
  if (!member.exists || !index.exists)
    throw new PracticeError("Shared deck is unavailable.", 404);
  const data = index.data()!;
  const ownerUid = documentId(data.ownerUid),
    deckId = documentId(data.deckId);
  if (index.id !== shareId(ownerUid, deckId))
    throw new PracticeError("Shared deck is unavailable.", 404);
  const deck = await tx.get(db.doc(`users/${ownerUid}/decks/${deckId}`));
  if (
    !deck.exists ||
    deck.data()!.visibility !== "team" ||
    deck.data()!.teamId !== teamId
  )
    throw new PracticeError("Shared deck is unavailable.", 404);
  return deck;
}

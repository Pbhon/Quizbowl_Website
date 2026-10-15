import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { PracticeError } from "./practice-persistence";
import { siteTeam } from "./site-team";

export async function requireTeacherCreator(
  db: Firestore,
  tx: Transaction,
  uid: string,
  verified: boolean,
) {
  if (!verified)
    throw new PracticeError(
      "Verify your email before editing teacher decks.",
      403,
    );
  const teamId = siteTeam().id;
  const [staff, member] = await Promise.all([
    tx.get(db.doc(`staff/${uid}`)),
    tx.get(db.doc(`teams/${teamId}/members/${uid}`)),
  ]);
  if (
    !member.exists ||
    staff.data()?.teamId !== teamId ||
    !["teacher", "admin"].includes(staff.data()?.role)
  )
    throw new PracticeError(
      "Current school staff access is required to edit teacher decks.",
      403,
    );
}
export async function requireDeckEditor(
  db: Firestore,
  tx: Transaction,
  uid: string,
  data: Record<string, unknown>,
  verified: boolean,
) {
  if (data.curatedBy === undefined) return;
  if (data.curatedBy !== uid)
    throw new PracticeError(
      "Only the teacher who created this deck can edit it.",
      403,
    );
  await requireTeacherCreator(db, tx, uid, verified);
}

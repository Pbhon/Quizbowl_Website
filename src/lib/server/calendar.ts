import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { siteTeam } from "./site-team";
import { PracticeError } from "./practice-persistence";
import type { CalendarEvent, CalendarWorkspace } from "@/lib/calendar";

export async function calendarAccess(
  db: Firestore,
  tx: Transaction,
  uid: string,
  verified: boolean,
) {
  const teamId = siteTeam().id;
  const staff = (await tx.get(db.doc(`staff/${uid}`))).data();
  const member = await tx.get(db.doc(`teams/${teamId}/members/${uid}`));
  const isStaff =
    verified &&
    staff?.teamId === teamId &&
    ["teacher", "admin"].includes(staff.role);
  if (!isStaff && !member.exists)
    throw new PracticeError("School membership required.", 403);
  return { teamId, isAdmin: Boolean(isStaff && staff?.role === "admin") };
}
export async function calendarWorkspace(
  db: Firestore,
  uid: string,
  verified: boolean,
): Promise<CalendarWorkspace> {
  return db.runTransaction(async (tx) => {
    const { teamId, isAdmin } = await calendarAccess(db, tx, uid, verified);
    const records = await tx.get(db.collection(`teams/${teamId}/events`));
    const events = records.docs
      .filter((doc) => isAdmin || doc.data().published === true)
      .map((doc) => ({ ...doc.data(), id: doc.id }) as CalendarEvent);
    return {
      isAdmin,
      events: events.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      announcements: [],
    };
  });
}

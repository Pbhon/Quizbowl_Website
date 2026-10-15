import "server-only";
import {
  FieldValue,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { deckText } from "./decks";
import { documentId } from "./history";
import { calendarDate, assignmentDeadline } from "@/lib/calendar";
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

export async function saveCalendar(
  db: Firestore,
  uid: string,
  verified: boolean,
  body: Record<string, unknown>,
) {
  if (!["create", "update"].includes(String(body.action)))
    throw new PracticeError("Unknown calendar action.", 400);
  if (typeof body.published !== "boolean")
    throw new PracticeError("Choose draft or published.", 400);
  let startsAt: string, endsAt: string | null;
  try {
    startsAt = calendarDate(body.startsAt);
    endsAt = body.endsAt ? calendarDate(body.endsAt) : null;
  } catch {
    throw new PracticeError("Enter a valid date and time.", 400);
  }
  if (endsAt && endsAt <= startsAt)
    throw new PracticeError("End time must follow start time.", 400);
  if (
    !["event", "competition", "practice"].includes(String(body.type ?? "event"))
  )
    throw new PracticeError("Choose a valid event type.", 400);
  const data = {
    title: deckText(body.title, 120, true),
    description: deckText(body.description ?? "", 2000),
    location: deckText(body.location ?? "", 300),
    type: body.type ?? "event",
    startsAt,
    endsAt,
    published: body.published,
    audience: "team",
    rsvpEnabled: false,
    updatedAt: FieldValue.serverTimestamp(),
  };
  return db.runTransaction(async (tx) => {
    const { teamId, isAdmin } = await calendarAccess(db, tx, uid, verified);
    if (!isAdmin)
      throw new PracticeError(
        "Verified school administrator access required.",
        403,
      );
    const ref =
      body.action === "create"
        ? db.collection(`teams/${teamId}/events`).doc()
        : db.doc(`teams/${teamId}/events/${documentId(body.id)}`);
    const existing = await tx.get(ref);
    if (body.action === "update" && !existing.exists)
      throw new PracticeError("Event not found.", 404);
    if (body.action === "create")
      tx.create(ref, {
        ...data,
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    else tx.update(ref, data);
    return { eventId: ref.id };
  });
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
    const assignments = await tx.get(
      db.collection(`teams/${teamId}/assignments`),
    );
    for (const doc of assignments.docs) {
      const deadline = assignmentDeadline(doc.id, doc.data(), uid, isAdmin);
      if (deadline) events.push(deadline);
    }
    return {
      isAdmin,
      events: events.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      announcements: [],
    };
  });
}

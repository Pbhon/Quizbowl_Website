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
  if (body.action === "rsvp") return saveRsvp(db, uid, verified, body);
  if (!["create", "update"].includes(String(body.action)))
    throw new PracticeError("Unknown calendar action.", 400);
  if (typeof body.published !== "boolean")
    throw new PracticeError("Choose draft or published.", 400);
  let startsAt: string, endsAt: string | null;
  if (body.rsvpEnabled !== undefined && typeof body.rsvpEnabled !== "boolean")
    throw new PracticeError("Choose an RSVP setting.", 400);
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
    rsvpEnabled: body.rsvpEnabled ?? false,
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
    for (const event of events.filter(
      (event) => event.type !== "assignment" && event.rsvpEnabled,
    )) {
      const path = `teams/${teamId}/events/${event.id}/rsvps`;
      event.response =
        (await tx.get(db.doc(`${path}/${uid}`))).data()?.response || "";
      if (isAdmin) {
        const responses = await tx.get(db.collection(path));
        event.responses = [];
        for (const response of responses.docs) {
          const member = await tx.get(
            db.doc(`teams/${teamId}/members/${response.id}`),
          );
          if (member.exists)
            event.responses.push({
              uid: response.id,
              name: String(member.data()?.displayName || "Team member"),
              response: response.data().response,
            });
        }
      }
    }
    return {
      isAdmin,
      events: events.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      announcements: [],
    };
  });
}

async function saveRsvp(
  db: Firestore,
  uid: string,
  verified: boolean,
  body: Record<string, unknown>,
) {
  if (
    !["going", "maybe", "declined", ""].includes(String(body.response)) ||
    typeof body.response !== "string"
  )
    throw new PracticeError("Choose a valid RSVP.", 400);
  return db.runTransaction(async (tx) => {
    const { teamId } = await calendarAccess(db, tx, uid, verified);
    const eventRef = db.doc(`teams/${teamId}/events/${documentId(body.id)}`);
    const event = (await tx.get(eventRef)).data();
    if (
      !event ||
      event.published !== true ||
      event.rsvpEnabled !== true ||
      !Number.isFinite(Date.parse(event.startsAt)) ||
      Date.parse(event.startsAt) <= Date.now()
    )
      throw new PracticeError("RSVPs are closed for this event.", 409);
    const ref = db.doc(`${eventRef.path}/rsvps/${uid}`);
    if (body.response === "") tx.delete(ref);
    else
      tx.set(ref, {
        response: body.response,
        updatedAt: FieldValue.serverTimestamp(),
      });
    return { saved: true };
  });
}

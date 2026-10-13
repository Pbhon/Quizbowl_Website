import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { requireTeamStaff, loadTeamRoster } from "./team-dashboard";
import { deckText } from "./decks";
import { PracticeError } from "./practice-persistence";
import { documentId } from "./history";
import { timestampISO } from "./dashboard";
import type { PracticeAssignment } from "@/lib/assignments";

export async function assignmentWorkspace(
  db: Firestore,
  uid: string,
  verified: boolean,
) {
  const teamId = await requireTeamStaff(db, uid, verified);
  const [records, roster] = await Promise.all([
    db.collection(`teams/${teamId}/assignments`).get(),
    loadTeamRoster(db, teamId),
  ]);
  await requireTeamStaff(db, uid, verified);
  return {
    assignments: records.docs
      .map(
        (doc) =>
          ({
            ...doc.data(),
            id: doc.id,
            dueAt: timestampISO(doc.data().dueAt),
          }) as PracticeAssignment,
      )
      .sort((a, b) => a.title.localeCompare(b.title)),
    students: roster.filter((member) => member.role === "student"),
  };
}

export async function saveAssignment(
  db: Firestore,
  uid: string,
  verified: boolean,
  body: Record<string, unknown>,
) {
  const teamId = await requireTeamStaff(db, uid, verified);
  if (!["create", "update"].includes(String(body.action)))
    throw new PracticeError("Unknown assignment action.", 400);
  if (typeof body.published !== "boolean")
    throw new PracticeError("Choose draft or published.", 400);
  const data = {
    title: deckText(body.title, 120, true),
    description: deckText(body.description ?? "", 2000),
    published: body.published,
    audience: "team",
    studentUids: [],
    questionCount: 10,
    type: "tossup",
    dueAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  };
  const ref =
    body.action === "create"
      ? db.collection(`teams/${teamId}/assignments`).doc()
      : db.doc(`teams/${teamId}/assignments/${documentId(body.id)}`);
  await db.runTransaction(async (tx) => {
    const staff = (await tx.get(db.doc(`staff/${uid}`))).data();
    if (
      !staff ||
      staff.teamId !== teamId ||
      !["teacher", "admin"].includes(staff.role)
    )
      throw new PracticeError("Staff access required.", 403);
    const existing = await tx.get(ref);
    if (body.action === "update" && !existing.exists)
      throw new PracticeError("Assignment not found.", 404);
    if (body.action === "create")
      tx.create(ref, {
        ...data,
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    else tx.update(ref, data);
  });
  return { assignmentId: ref.id };
}

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
  const audience = body.audience ?? "team";
  if (!["team", "students"].includes(String(audience)))
    throw new PracticeError("Choose an assignment audience.", 400);
  if (
    !Array.isArray(body.studentUids ?? []) ||
    (body.studentUids as unknown[] | undefined)?.length! > 200
  )
    throw new PracticeError("Choose up to 200 students.", 400);
  const studentUids =
    audience === "team"
      ? []
      : [...new Set(((body.studentUids as unknown[]) || []).map(documentId))];
  if (audience === "students" && studentUids.length !== 1)
    throw new PracticeError("Choose one student.", 400);
  const data = {
    title: deckText(body.title, 120, true),
    description: deckText(body.description ?? "", 2000),
    published: body.published,
    audience,
    studentUids,
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
    for (const studentUid of studentUids) {
      const member = await tx.get(
        db.doc(`teams/${teamId}/members/${studentUid}`),
      );
      const studentStaff = (await tx.get(db.doc(`staff/${studentUid}`))).data();
      if (
        !member.exists ||
        (studentStaff?.teamId === teamId &&
          ["teacher", "admin"].includes(studentStaff.role))
      )
        throw new PracticeError(
          "Choose current students from your school.",
          400,
        );
    }
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

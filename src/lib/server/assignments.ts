import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { requireTeamStaff, loadTeamRoster } from "./team-dashboard";
import { deckText } from "./decks";
import { PracticeError } from "./practice-persistence";
import { documentId } from "./history";
import { timestampISO } from "./dashboard";
import { assignmentResult, type PracticeAssignment } from "@/lib/assignments";
import { siteTeam } from "./site-team";
import { subjects } from "@/lib/practice";

export async function assignmentWorkspace(
  db: Firestore,
  uid: string,
  verified: boolean,
) {
  const teamId = siteTeam().id;
  const staff = (await db.doc(`staff/${uid}`).get()).data();
  const isStaff =
    verified &&
    staff?.teamId === teamId &&
    ["teacher", "admin"].includes(staff.role);
  if (
    !isStaff &&
    !(await db.doc(`teams/${teamId}/members/${uid}`).get()).exists
  )
    throw new PracticeError("School membership required.", 403);
  const [records, roster] = await Promise.all([
    db.collection(`teams/${teamId}/assignments`).get(),
    isStaff
      ? loadTeamRoster(db, teamId)
      : Promise.resolve([
          { uid, displayName: "You", role: "student" as const },
        ]),
  ]);
  const students = roster.filter((member) => member.role === "student");
  const assignments = await Promise.all(
    records.docs
      .filter(
        (doc) =>
          isStaff ||
          assignmentResult(doc.id, doc.data(), undefined, uid, "You") !== null,
      )
      .map(async (doc) => {
        const normalized = {
          ...doc.data(),
          dueAt: timestampISO(doc.data().dueAt),
        };
        const results = await Promise.all(
          students.map(async (student) => {
            if (
              !assignmentResult(
                doc.id,
                normalized,
                undefined,
                student.uid,
                student.displayName,
              )
            )
              return null;
            const progress = (
              await doc.ref.collection("progress").doc(student.uid).get()
            ).data();
            return assignmentResult(
              doc.id,
              normalized,
              progress,
              student.uid,
              student.displayName,
            );
          }),
        );
        return {
          ...normalized,
          id: doc.id,
          results: results.filter((result) => result !== null),
        } as PracticeAssignment;
      }),
  );
  if (isStaff) await requireTeamStaff(db, uid, verified);
  else if (!(await db.doc(`teams/${teamId}/members/${uid}`).get()).exists)
    throw new PracticeError("School membership required.", 403);
  const current = await db.collection(`teams/${teamId}/members`).get();
  if (
    students.some(
      (student) => !current.docs.some((doc) => doc.id === student.uid),
    )
  )
    throw new PracticeError("Roster changed. Please refresh assignments.", 409);
  return {
    isStaff,
    assignments: assignments.sort((a, b) => a.title.localeCompare(b.title)),
    students: isStaff ? students : [],
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
    ((body.studentUids as unknown[] | undefined)?.length ?? 0) > 200
  )
    throw new PracticeError("Choose up to 200 students.", 400);
  const studentUids =
    audience === "team"
      ? []
      : [...new Set(((body.studentUids as unknown[]) || []).map(documentId))];
  if (audience === "students" && !studentUids.length)
    throw new PracticeError("Choose at least one student.", 400);
  const questionCount = body.questionCount ?? 10,
    difficultyMin = body.difficultyMin ?? 0,
    difficultyMax = body.difficultyMax ?? 10;
  if (
    !Number.isInteger(questionCount) ||
    Number(questionCount) < 1 ||
    Number(questionCount) > 500 ||
    !Number.isInteger(difficultyMin) ||
    !Number.isInteger(difficultyMax) ||
    Number(difficultyMin) < 0 ||
    Number(difficultyMax) > 10 ||
    Number(difficultyMin) > Number(difficultyMax)
  )
    throw new PracticeError(
      "Use 1–500 questions and a difficulty range within 0–10.",
      400,
    );
  const type = body.type ?? "tossup";
  if (!["tossup", "bonus"].includes(String(type)))
    throw new PracticeError("Choose tossup or bonus questions.", 400);
  const data = {
    category: deckText(body.category ?? "", 80),
    subcategory: deckText(body.subcategory ?? "", 80),
    topic: deckText(body.topic ?? "", 200),
    title: deckText(body.title, 120, true),
    description: deckText(body.description ?? "", 2000),
    published: body.published,
    audience,
    studentUids,
    questionCount,
    difficultyMin,
    difficultyMax,
    type,
    dueAt:
      body.dueAt == null || body.dueAt === ""
        ? null
        : deckText(body.dueAt, 40, true),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (
    (data.category && !Object.hasOwn(subjects, data.category)) ||
    (data.subcategory &&
      !(
        data.category ? subjects[data.category] : Object.values(subjects).flat()
      ).includes(data.subcategory))
  )
    throw new PracticeError(
      "Choose a valid category and matching subcategory.",
      400,
    );
  if (
    data.dueAt !== null &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(data.dueAt) ||
      !Number.isFinite(Date.parse(data.dueAt)))
  )
    throw new PracticeError("Enter a valid deadline.", 400);
  if (data.dueAt) data.dueAt = new Date(data.dueAt).toISOString();
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

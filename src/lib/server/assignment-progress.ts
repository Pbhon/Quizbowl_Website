import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  FieldValue,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import {
  assignmentAudience,
  currentAssignmentProgress,
  matchesAssignment,
  requirementsVersion,
} from "@/lib/assignment-requirements";
import type { Question, Outcome } from "@/lib/practice";
import { PracticeError } from "./practice-persistence";
import { siteTeam } from "./site-team";

export type AssignmentBinding = {
  id: string;
  teamId: string;
  requirementsVersion: number;
};
function recordId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value))
    throw new PracticeError("Invalid assignment identifier.", 400);
  return value;
}
const questionKey = (question: Question) =>
  createHash("sha256").update(`${question.type}:${question.id}`).digest("hex");
export async function readAssignment(
  db: Firestore,
  tx: Transaction,
  uid: string,
  id: unknown,
  version?: number,
) {
  const teamId = siteTeam().id;
  const ref = db.doc(`teams/${teamId}/assignments/${recordId(id)}`);
  const [assignment, member, staff] = await tx.getAll(
    ref,
    db.doc(`teams/${teamId}/members/${uid}`),
    db.doc(`staff/${uid}`),
  );
  const data = assignment.data();
  if (
    !member.exists ||
    !data ||
    !assignmentAudience(data, uid) ||
    (staff.data()?.teamId === teamId &&
      ["teacher", "admin"].includes(staff.data()!.role))
  )
    throw new PracticeError(
      "This assignment is no longer available to you.",
      403,
    );
  if (version !== undefined && version !== requirementsVersion(data))
    throw new PracticeError(
      "Assignment requirements changed. Start a new assignment session.",
      409,
    );
  if (
    !Number.isInteger(data.questionCount) ||
    data.questionCount < 1 ||
    data.questionCount > 500
  )
    throw new PracticeError(
      "This assignment has invalid question requirements.",
      409,
    );
  return {
    ref,
    data,
    binding: {
      id: ref.id,
      teamId,
      requirementsVersion: requirementsVersion(data),
    },
  };
}
export async function assignmentPracticeSource(
  db: Firestore,
  uid: string,
  id: unknown,
) {
  return db.runTransaction(async (tx) => {
    const assignment = await readAssignment(db, tx, uid, id);
    const progressRef = assignment.ref.collection("progress").doc(uid);
    const progress = currentAssignmentProgress(
      assignment.data,
      (await tx.get(progressRef)).data(),
    );
    const completed = await tx.get(
      progressRef
        .collection("versions")
        .doc(String(assignment.binding.requirementsVersion))
        .collection("questions")
        .where("completed", "==", true),
    );
    const remaining =
      Number(assignment.data.questionCount) -
      Number(progress?.completedQuestions ?? 0);
    if (remaining <= 0)
      throw new PracticeError("You have completed this assignment.", 409);
    return {
      data: assignment.data,
      binding: assignment.binding,
      count: Math.min(50, remaining),
      excluded: completed.docs.map((doc) => String(doc.data().questionId)),
    };
  });
}
export async function createAssignmentSession(
  db: Firestore,
  uid: string,
  binding: AssignmentBinding,
  questions: Question[],
) {
  const sessionRef = db.doc(`users/${uid}/practiceSessions/${randomUUID()}`);
  return db.runTransaction(async (tx) => {
    const assignment = await readAssignment(
      db,
      tx,
      uid,
      binding.id,
      binding.requirementsVersion,
    );
    const progressRef = assignment.ref.collection("progress").doc(uid);
    const progress = currentAssignmentProgress(
      assignment.data,
      (await tx.get(progressRef)).data(),
    );
    const remaining =
      Number(assignment.data.questionCount) -
      Number(progress?.completedQuestions ?? 0);
    const unique = [
      ...new Map(
        questions.map((question) => [questionKey(question), question]),
      ).values(),
    ]
      .filter((question) => matchesAssignment(question, assignment.data))
      .slice(0, 50);
    const credits = unique.length
      ? await tx.getAll(
          ...unique.map((question) =>
            progressRef
              .collection("versions")
              .doc(String(binding.requirementsVersion))
              .collection("questions")
              .doc(questionKey(question)),
          ),
        )
      : [];
    const selected = unique
      .filter((_, index) => !credits[index].data()?.completed)
      .slice(0, Math.max(0, remaining));
    if (!selected.length)
      throw new PracticeError(
        "No new matching questions remain. Refresh the assignment or try again.",
        409,
      );
    tx.create(sessionRef, {
      assignment: assignment.binding,
      createdAt: FieldValue.serverTimestamp(),
      questionCount: selected.length,
      totalParts: selected.reduce(
        (sum, question) => sum + question.parts.length,
        0,
      ),
      attemptedParts: 0,
      correct: 0,
      incorrect: 0,
      skipped: 0,
    });
    selected.forEach((question, index) =>
      tx.create(
        sessionRef.collection("questions").doc(String(index)),
        question,
      ),
    );
    return {
      sessionId: sessionRef.id,
      questions: selected,
      assignmentTitle: assignment.data.title,
    };
  });
}
// Read before any attempt writes, then invoke the returned writer in that same transaction.
export async function prepareAssignmentCredit(
  db: Firestore,
  tx: Transaction,
  uid: string,
  binding: AssignmentBinding | undefined,
  question: Question,
  part: number,
  outcome: Outcome | "prompt",
) {
  if (!binding || outcome === "prompt") return () => {};
  if (binding.teamId !== siteTeam().id)
    throw new PracticeError(
      "Assignment school changed. Start a new session.",
      409,
    );
  const assignment = await readAssignment(
    db,
    tx,
    uid,
    binding.id,
    binding.requirementsVersion,
  );
  if (!matchesAssignment(question, assignment.data))
    throw new PracticeError(
      "This question no longer matches the assignment.",
      409,
    );
  const progressRef = assignment.ref.collection("progress").doc(uid);
  const creditRef = progressRef
    .collection("versions")
    .doc(String(binding.requirementsVersion))
    .collection("questions")
    .doc(questionKey(question));
  const [progressSnapshot, creditSnapshot] = await tx.getAll(
    progressRef,
    creditRef,
  );
  const progress = currentAssignmentProgress(
    assignment.data,
    progressSnapshot.data(),
  );
  const completedQuestions = Number(progress?.completedQuestions ?? 0);
  const previous = creditSnapshot.data();
  if (
    previous?.parts?.[part] ||
    completedQuestions >= Number(assignment.data.questionCount)
  )
    return () => {};
  const parts = { ...(previous?.parts || {}), [part]: outcome };
  const completed = question.parts.every(
    (_, index) => parts[index] !== undefined,
  );
  return () => {
    const timestamp = FieldValue.serverTimestamp();
    tx.set(creditRef, {
      questionId: question.id,
      type: question.type,
      parts,
      completed,
      updatedAt: timestamp,
    });
    tx.set(progressRef, {
      requirementsVersion: binding.requirementsVersion,
      completedQuestions: completedQuestions + (completed ? 1 : 0),
      correct: Number(progress?.correct ?? 0) + (outcome === "correct" ? 1 : 0),
      incorrect:
        Number(progress?.incorrect ?? 0) + (outcome === "incorrect" ? 1 : 0),
      skipped: Number(progress?.skipped ?? 0) + (outcome === "skipped" ? 1 : 0),
      updatedAt: timestamp,
      ...(completedQuestions + (completed ? 1 : 0) >=
      Number(assignment.data.questionCount)
        ? { completedAt: timestamp }
        : {}),
    });
  };
}

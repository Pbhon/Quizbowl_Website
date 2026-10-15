import type { Question } from "./practice";

export const requirementFields = [
  "questionCount",
  "type",
  "difficultyMin",
  "difficultyMax",
  "category",
  "subcategory",
  "topic",
] as const;
export function requirementsVersion(data: Record<string, unknown>) {
  return typeof data.requirementsVersion === "number" &&
    Number.isSafeInteger(data.requirementsVersion) &&
    data.requirementsVersion > 0
    ? data.requirementsVersion
    : 1;
}
export function assignmentAudience(data: Record<string, unknown>, uid: string) {
  return (
    data.published === true &&
    data.status !== "cancelled" &&
    (data.audience === "team" ||
      (Array.isArray(data.studentUids) && data.studentUids.includes(uid)))
  );
}
export function matchesAssignment(
  question: Question,
  data: Record<string, unknown>,
) {
  const text = [question.leadin, ...question.parts, ...question.answerLines]
    .join(" ")
    .toLocaleLowerCase();
  const topic =
    typeof data.topic === "string" ? data.topic.trim().toLocaleLowerCase() : "";
  return (
    question.type === (data.type ?? "tossup") &&
    Number.isInteger(question.difficulty) &&
    question.difficulty >= Number(data.difficultyMin ?? 0) &&
    question.difficulty <= Number(data.difficultyMax ?? 10) &&
    (!data.category || question.category === data.category) &&
    (!data.subcategory || question.subcategory === data.subcategory) &&
    (!topic || topic.split(/\s+/).every((word) => text.includes(word)))
  );
}
export function currentAssignmentProgress(
  assignment: Record<string, unknown>,
  progress: Record<string, unknown> | undefined,
) {
  return progress &&
    requirementsVersion(progress) === requirementsVersion(assignment)
    ? progress
    : undefined;
}

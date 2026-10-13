import {
  assignmentCompletion,
  type AssignmentCompletion,
} from "./team-dashboard";
export type AssignmentResult = AssignmentCompletion & {
  uid: string;
  displayName: string;
  correct: number | null;
  incorrect: number | null;
  skipped: number | null;
  accuracy: number | null;
};
export function assignmentResult(
  id: string,
  assignment: Record<string, unknown>,
  progress: Record<string, unknown> | undefined,
  uid: string,
  displayName: string,
): AssignmentResult | null {
  const completion = assignmentCompletion(id, assignment, progress, uid);
  if (!completion) return null;
  const counts = [progress?.correct, progress?.incorrect, progress?.skipped];
  const valid = counts.every(
    (value) =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
  );
  const [correct, incorrect, skipped] = valid
    ? (counts as number[])
    : [null, null, null];
  return {
    ...completion,
    uid,
    displayName,
    correct,
    incorrect,
    skipped,
    accuracy:
      correct !== null && incorrect !== null && correct + incorrect > 0
        ? (correct / (correct + incorrect)) * 100
        : null,
  };
}
export type PracticeAssignment = {
  id: string;
  title: string;
  description: string;
  published: boolean;
  audience: "team" | "students";
  studentUids: string[];
  questionCount: number;
  difficultyMin: number;
  difficultyMax: number;
  category: string;
  subcategory: string;
  topic: string;
  type: "tossup" | "bonus";
  dueAt: string | null;
  results: AssignmentResult[];
};

export type AssignmentWorkspace = {
  isStaff: boolean;
  assignments: PracticeAssignment[];
  students: { uid: string; displayName: string }[];
};

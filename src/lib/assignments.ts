export type PracticeAssignment = {
  id: string;
  title: string;
  description: string;
  published: boolean;
  audience: "team" | "students";
  studentUids: string[];
  questionCount: number;
  type: "tossup" | "bonus";
  dueAt: string | null;
};

export type AssignmentWorkspace = {
  assignments: PracticeAssignment[];
  students: { uid: string; displayName: string }[];
};

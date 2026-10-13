import {
  buildStatistics,
  type StatisticAttempt,
  type Performance,
} from "./statistics";
export type TeamMember = {
  uid: string;
  displayName: string;
  role: "student" | "teacher" | "admin";
};
export type TeamStatistics = ReturnType<typeof buildStatistics>;
export type HeatmapCell = Performance & {
  category: string;
  difficulty: number;
};
export type TeamDashboardData = {
  members: TeamMember[];
  students: (TeamMember & {
    statistics: TeamStatistics;
    heatmap: HeatmapCell[];
    participation: Participation;
    assignments: AssignmentCompletion[];
    study: StudyActivity;
  })[];
  team: TeamStatistics;
  heatmap: HeatmapCell[];
  generatedAt: string;
};
export function subjectDifficulty(
  attempts: StatisticAttempt[],
  now = new Date(),
  timeZone = "UTC",
): HeatmapCell[] {
  const groups = new Map<
    string,
    { category: string; difficulty: number; attempts: StatisticAttempt[] }
  >();
  for (const attempt of attempts) {
    const category = attempt.question.category || "Uncategorized",
      difficulty = attempt.question.difficulty;
    const key = JSON.stringify([category, difficulty]);
    if (!groups.has(key))
      groups.set(key, { category, difficulty, attempts: [] });
    groups.get(key)!.attempts.push(attempt);
  }
  return [...groups.values()]
    .map((group) => ({
      ...buildStatistics(group.attempts, now, timeZone).total,
      category: group.category,
      difficulty: group.difficulty,
    }))
    .filter((cell) => cell.attempted > 0)
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) || a.difficulty - b.difficulty,
    );
}

export type Participation = {
  lastPracticeAt: string | null;
  sessions: number;
  activeDays: number;
  status: "active" | "inactive" | "never";
};
export function participation(
  attempts: StatisticAttempt[],
  now = new Date(),
  timeZone = "UTC",
): Participation {
  const completed = attempts.filter(
    (a) =>
      ["correct", "incorrect", "skipped"].includes(a.outcome) &&
      a.completedAt &&
      Number.isFinite(new Date(a.completedAt).getTime()) &&
      new Date(a.completedAt) <= now,
  );
  const lastPracticeAt =
    completed
      .map((a) => a.completedAt!)
      .sort()
      .at(-1) || null;
  const daily = buildStatistics(completed, now, timeZone).activity.daily;
  return {
    lastPracticeAt,
    sessions: new Set(completed.map((a) => a.sessionId)).size,
    activeDays: daily.filter((day) => day.attempted > 0).length,
    status: !lastPracticeAt
      ? "never"
      : new Date(lastPracticeAt).getTime() >= now.getTime() - 7 * 86400000
        ? "active"
        : "inactive",
  };
}

export type AssignmentCompletion = {
  id: string;
  title: string;
  dueAt: string | null;
  completedQuestions: number;
  questionCount: number;
  status: "completed" | "in progress" | "not started" | "overdue";
};
export function assignmentCompletion(
  id: string,
  assignment: Record<string, unknown>,
  progress: Record<string, unknown> | undefined,
  uid: string,
  now = new Date(),
): AssignmentCompletion | null {
  if (
    assignment.published !== true ||
    assignment.status === "cancelled" ||
    !(
      assignment.audience === "team" ||
      (Array.isArray(assignment.studentUids) &&
        assignment.studentUids.includes(uid))
    )
  )
    return null;
  const questionCount =
    typeof assignment.questionCount === "number" &&
    Number.isInteger(assignment.questionCount) &&
    assignment.questionCount > 0
      ? assignment.questionCount
      : 0;
  const completedQuestions =
    typeof progress?.completedQuestions === "number" &&
    Number.isInteger(progress.completedQuestions)
      ? Math.max(0, Math.min(questionCount, progress.completedQuestions))
      : 0;
  const dueAt =
    typeof assignment.dueAt === "string" &&
    Number.isFinite(new Date(assignment.dueAt).getTime())
      ? assignment.dueAt
      : null;
  const completed = questionCount > 0 && completedQuestions >= questionCount;
  return {
    id,
    title: String(assignment.title || "Untitled assignment"),
    dueAt,
    completedQuestions,
    questionCount,
    status: completed
      ? "completed"
      : dueAt && new Date(dueAt) < now
        ? "overdue"
        : completedQuestions > 0
          ? "in progress"
          : "not started",
  };
}

export type StudyActivity = {
  decks: number;
  savedCards: number;
  lastDeckChange: string | null;
  reviews: number;
  lastReviewAt: string | null;
  today: number;
  thisWeek: number;
  thisMonth: number;
};

function csvValue(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function teamStatisticsCSV(
  data: TeamDashboardData,
  studentUid?: string,
): string {
  const selected = studentUid
    ? data.students.filter((s) => s.uid === studentUid)
    : data.students;
  const rows: unknown[][] = [
    [
      "Student ID",
      "Student",
      "Section",
      "Area",
      "Category",
      "Difficulty",
      "Questions",
      "Responses",
      "Correct",
      "Incorrect",
      "Skipped",
      "Accuracy (%)",
      "Participation",
      "Last practice",
      "Active days (30)",
      "Practice sessions",
      "Decks",
      "Saved cards",
      "Reviews",
      "Reviews today",
      "Reviews this week",
      "Reviews this month",
      "Last deck change",
      "Last review",
      "Assignment completed questions",
      "Assignment target",
      "Assignment status",
      "Assignment deadline",
      "Time zone",
      "Generated at",
    ],
  ];
  const exportStats = (
    uid: string,
    name: string,
    statistics: TeamStatistics,
    student?: TeamDashboardData["students"][number],
  ) => {
    const push = (
      section: string,
      area: string,
      perf?: Performance,
      category = "",
      difficulty: number | string = "",
      assignment?: AssignmentCompletion,
    ) =>
      rows.push([
        uid,
        name,
        section,
        area,
        category,
        difficulty,
        perf?.questions,
        perf?.attempted,
        perf?.correct,
        perf?.incorrect,
        perf?.skipped,
        perf?.accuracy,
        student?.participation.status,
        student?.participation.lastPracticeAt,
        student?.participation.activeDays,
        student?.participation.sessions,
        student?.study.decks,
        student?.study.savedCards,
        student?.study.reviews,
        student?.study.today,
        student?.study.thisWeek,
        student?.study.thisMonth,
        student?.study.lastDeckChange,
        student?.study.lastReviewAt,
        assignment?.completedQuestions,
        assignment?.questionCount,
        assignment?.status,
        assignment?.dueAt,
        statistics.timeZone,
        data.generatedAt,
      ]);
    push("overall", "All practice", statistics.total);
    for (const section of [
      "categories",
      "subcategories",
      "difficulties",
    ] as const)
      for (const row of statistics[section])
        push(
          section,
          row.label,
          row,
          row.category,
          section === "difficulties" ? row.label : "",
        );
    for (const period of ["daily", "weekly", "monthly"] as const)
      for (const row of statistics.activity[period])
        push(period, row.label, row);
    for (const cell of student?.heatmap || data.heatmap)
      push("heatmap", cell.category, cell, cell.category, cell.difficulty);
    for (const assignment of student?.assignments || [])
      push("assignment", assignment.title, undefined, "", "", assignment);
  };
  if (!studentUid) exportStats("", "Entire student team", data.team);
  for (const student of selected)
    exportStats(student.uid, student.displayName, student.statistics, student);
  return (
    "\uFEFF" +
    rows.map((row) => row.map(csvValue).join(",")).join("\r\n") +
    "\r\n"
  );
}

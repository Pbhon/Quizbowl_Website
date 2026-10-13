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

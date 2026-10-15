import type { Outcome, Question } from "./practice";

export type StatisticAttempt = {
  sessionId: string;
  questionIndex: number;
  part: number;
  outcome: Outcome | "prompt";
  question: Pick<Question, "category" | "subcategory" | "difficulty">;
  completedAt: string | null;
};
export type Performance = {
  questions: number;
  attempted: number;
  correct: number;
  incorrect: number;
  skipped: number;
  accuracy: number | null;
};
export type Breakdown = Performance & { label: string; category?: string };
export type RecentSession = {
  id: string;
  createdAt: string;
  questionCount: number;
  totalParts: number;
  attemptedParts: number;
  correct: number;
  incorrect: number;
  skipped: number;
  completed: boolean;
};
export type Upcoming = {
  id: string;
  title: string;
  date: string;
  kind: "assignment" | "competition" | "practice" | "event";
};
const empty = (): Performance => ({
  questions: 0,
  attempted: 0,
  correct: 0,
  incorrect: 0,
  skipped: 0,
  accuracy: null,
});
function add(stats: Performance, outcome: Outcome) {
  stats.attempted++;
  stats[outcome]++;
  const answered = stats.correct + stats.incorrect;
  stats.accuracy = answered ? (stats.correct / answered) * 100 : null;
}
export function dateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function periodKey(day: string, period: "daily" | "weekly" | "monthly") {
  if (period === "daily") return day;
  if (period === "monthly") return day.slice(0, 7);
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export function buildStatistics(
  attempts: StatisticAttempt[],
  now = new Date(),
  timeZone = "UTC",
) {
  const total = empty();
  const questions = new Set<string>();
  const categories = new Map<string, Breakdown>();
  const subcategories = new Map<string, Breakdown>();
  const difficulties = new Map<string, Breakdown>();
  const activity = {
    daily: new Map<string, Breakdown>(),
    weekly: new Map<string, Breakdown>(),
    monthly: new Map<string, Breakdown>(),
  };
  const today = dateKey(now, timeZone);
  const questionSets = new WeakMap<Performance, Set<string>>();
  function count(stats: Performance, outcome: Outcome, questionKey: string) {
    add(stats, outcome);
    if (!questionSets.has(stats)) questionSets.set(stats, new Set());
    const keys = questionSets.get(stats)!;
    keys.add(questionKey);
    stats.questions = keys.size;
  }
  for (const period of ["daily", "weekly", "monthly"] as const) {
    const date = new Date(`${today}T12:00:00Z`);
    for (let i = 0; i < (period === "daily" ? 30 : 12); i++) {
      const cursor = new Date(date);
      if (period === "monthly") {
        cursor.setUTCDate(1);
        cursor.setUTCMonth(cursor.getUTCMonth() - i);
      } else
        cursor.setUTCDate(
          cursor.getUTCDate() - i * (period === "weekly" ? 7 : 1),
        );
      const key = periodKey(cursor.toISOString().slice(0, 10), period);
      activity[period].set(key, { ...empty(), label: key });
    }
  }
  function record(
    map: Map<string, Breakdown>,
    key: string,
    label: string,
    outcome: Outcome,
    questionKey: string,
    category?: string,
  ) {
    if (!map.has(key))
      map.set(key, { ...empty(), label, ...(category ? { category } : {}) });
    count(map.get(key)!, outcome, questionKey);
  }
  for (const attempt of attempts) {
    if (
      !["correct", "incorrect", "skipped"].includes(attempt.outcome) ||
      !attempt.completedAt
    )
      continue;
    const date = new Date(attempt.completedAt);
    if (!Number.isFinite(date.getTime()) || date > now) continue;
    const outcome = attempt.outcome as Outcome;
    const questionKey = `${attempt.sessionId}:${attempt.questionIndex}`;
    count(total, outcome, questionKey);
    questions.add(questionKey);
    const category = attempt.question.category || "Uncategorized";
    const subcategory = attempt.question.subcategory || "Unspecified";
    record(categories, category, category, outcome, questionKey);
    record(
      subcategories,
      JSON.stringify([category, subcategory]),
      subcategory,
      outcome,
      questionKey,
      category,
    );
    record(
      difficulties,
      String(attempt.question.difficulty),
      String(attempt.question.difficulty),
      outcome,
      questionKey,
    );
    const day = dateKey(date, timeZone);
    for (const period of ["daily", "weekly", "monthly"] as const) {
      const key = periodKey(day, period);
      if (activity[period].has(key))
        count(activity[period].get(key)!, outcome, questionKey);
    }
  }
  const sorted = (map: Map<string, Breakdown>) =>
    [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  const categoryRows = sorted(categories);
  const subcategoryRows = sorted(subcategories);
  const recommendations = [...subcategoryRows]
    .filter(
      (row) =>
        row.correct + row.incorrect >= 3 &&
        row.accuracy !== null &&
        row.accuracy < 70,
    )
    .sort((a, b) => a.accuracy! - b.accuracy! || b.attempted - a.attempted)
    .slice(0, 3);
  return {
    total,
    totalQuestions: questions.size,
    categories: categoryRows,
    subcategories: subcategoryRows,
    difficulties: sorted(difficulties).sort(
      (a, b) => Number(a.label) - Number(b.label),
    ),
    recommendations,
    activity: {
      daily: sorted(activity.daily),
      weekly: sorted(activity.weekly),
      monthly: sorted(activity.monthly),
    },
    current: {
      daily: activity.daily.get(today)!,
      weekly: activity.weekly.get(periodKey(today, "weekly"))!,
      monthly: activity.monthly.get(today.slice(0, 7))!,
    },
    timeZone,
  };
}
export type DashboardData = ReturnType<typeof buildStatistics> & {
  sessions: RecentSession[];
  upcoming: Upcoming[];
};

export function eligibleUpcoming(
  data: Record<string, unknown>,
  uid: string,
  now: Date,
  dateField: string,
) {
  const date =
    typeof data[dateField] === "string"
      ? new Date(data[dateField] as string)
      : null;
  return Boolean(
    date &&
    Number.isFinite(date.getTime()) &&
    date >= now &&
    data.published === true &&
    data.status !== "cancelled" &&
    data.status !== "completed" &&
    (data.audience === "team" ||
      (Array.isArray(data.studentUids) && data.studentUids.includes(uid))),
  );
}

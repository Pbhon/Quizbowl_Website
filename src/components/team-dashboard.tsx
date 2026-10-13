"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "firebase/auth";
import { useAuth } from "./auth-provider";
import { AccountGuard } from "./account-guard";
import { PageHeading } from "./page-heading";
import { Notice } from "./form-field";
import { Button } from "./ui/button";
import type { Breakdown } from "@/lib/statistics";
import type { TeamDashboardData } from "@/lib/team-dashboard";
import type { HeatmapCell } from "@/lib/team-dashboard";
export function TeamDashboard() {
  const { user, access } = useAuth();
  return (
    <AccountGuard staff>
      {user && (
        <Workspace
          key={`${user.uid}:${access.teamId}:${access.role}`}
          user={user}
        />
      )}
    </AccountGuard>
  );
}
function Workspace({ user }: { user: User }) {
  const [data, setData] = useState<TeamDashboardData | null>(null);
  const [selected, setSelected] = useState("");
  const members = data?.members;
  const statistics = selected
    ? data?.students.find((s) => s.uid === selected)?.statistics
    : data?.team;
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);
  async function download() {
    setExporting(true);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const response = await fetch(
        `/api/team/dashboard?format=csv&timeZone=${encodeURIComponent(timeZone)}${selected ? `&student=${encodeURIComponent(selected)}` : ""}`,
        {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = `quizbowl-${selected ? "student" : "team"}-statistics.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setData(null);
      setError(
        failure instanceof Error
          ? failure.message
          : "Export failed. Please retry.",
      );
    } finally {
      setExporting(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/team/dashboard?timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
          {
            headers: { Authorization: `Bearer ${await user.getIdToken()}` },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!controller.signal.aborted) {
          setData(body);
          setSelected((previous) =>
            body.students.some(
              (student: { uid: string }) => student.uid === previous,
            )
              ? previous
              : "",
          );
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : "Please retry.",
          );
      }
    })();
    return () => controller.abort();
  }, [user, reload]);
  return (
    <div className="space-y-6">
      <PageHeading
        title="Teacher/Admin dashboard"
        description="Your school's roster and student practice progress."
      />
      <Button
        variant="outline"
        onClick={() => {
          setData(null);
          setError("");
          setReload((n) => n + 1);
        }}
      >
        Refresh team statistics
      </Button>
      {error ? (
        <Notice error>{error}</Notice>
      ) : !members ? (
        <Notice>Loading team statistics…</Notice>
      ) : (
        <>
          <Button onClick={() => void download()} disabled={exporting}>
            {exporting
              ? "Exporting…"
              : selected
                ? "Export individual statistics to CSV"
                : "Export team statistics to CSV"}
          </Button>
          <h2 className="text-xl font-semibold">
            Team members ({members.length})
          </h2>
          {members.length === 0 && <Notice>No team members yet.</Notice>}
          <label className="block">
            Statistics for
            <select
              aria-label="Statistics for"
              className="form-select mt-2"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Entire student team</option>
              {data?.students.map((student) => (
                <option key={student.uid} value={student.uid}>
                  {student.displayName}
                </option>
              ))}
            </select>
          </label>
          {statistics && (
            <section className="space-y-4" aria-label="Student statistics">
              <div
                className="flex flex-wrap gap-5"
                aria-label="Response totals"
              >
                <span>Correct: {statistics.total.correct}</span>
                <span>Incorrect: {statistics.total.incorrect}</span>
                <span>Skipped: {statistics.total.skipped}</span>
                <span>Responses: {statistics.total.attempted}</span>
              </div>
              <p className="text-2xl font-semibold">
                Questions attempted: {statistics.totalQuestions}
              </p>
              <h2 className="text-xl font-semibold">
                {selected
                  ? members.find((m) => m.uid === selected)?.displayName
                  : "Entire student team"}
              </h2>
              <p>
                Overall accuracy:{" "}
                {statistics.total.accuracy === null
                  ? "—"
                  : `${statistics.total.accuracy.toFixed(1)}%`}
              </p>
              <p>
                Accuracy excludes skipped responses and pending clarifications.
                Bonus parts count separately; questions count once per session.
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                {(["daily", "weekly", "monthly"] as const).map((period, i) => (
                  <div className="rounded-xl border p-4" key={period}>
                    <h3>{["Today", "This week", "This month"][i]}</h3>
                    <p>
                      {statistics.current[period].questions} questions ·{" "}
                      {statistics.current[period].attempted} responses
                    </p>
                    <p>
                      {percent(statistics.current[period].accuracy)} accuracy
                    </p>
                  </div>
                ))}
              </div>
              <WeakTopics rows={statistics.recommendations} />
              <Activity statistics={statistics} />
              <Heatmap
                cells={
                  (selected
                    ? data?.students.find((s) => s.uid === selected)?.heatmap
                    : data?.heatmap) || []
                }
              />
              <div className="grid gap-6 lg:grid-cols-2">
                <PerformanceTable
                  title="Accuracy by subject"
                  rows={statistics.categories}
                />
                <PerformanceTable
                  title="Accuracy by difficulty"
                  rows={statistics.difficulties}
                />
                <PerformanceTable
                  title="Accuracy by subcategory"
                  rows={statistics.subcategories}
                />
              </div>
            </section>
          )}
          <AssignmentTable
            students={(data?.students || []).filter(
              (s) => !selected || s.uid === selected,
            )}
          />
          <StudyTable
            students={(data?.students || []).filter(
              (s) => !selected || s.uid === selected,
            )}
          />
          <ParticipationTable students={data?.students || []} />
          <ul className="divide-y">
            {members.map((member) => (
              <li
                className="flex flex-wrap justify-between gap-2 py-3"
                key={member.uid}
              >
                <span>{member.displayName}</span>
                <span>{member.role}</span>
                {data?.students.find((s) => s.uid === member.uid) && (
                  <span>
                    Questions:{" "}
                    {
                      data.students.find((s) => s.uid === member.uid)!
                        .statistics.totalQuestions
                    }
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const percent = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)}%`;
function PerformanceTable({
  title,
  rows,
}: {
  title: string;
  rows: Breakdown[];
}) {
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4">
      <h3 className="mb-3 font-semibold">{title}</h3>
      {!rows.length ? (
        <p>No completed practice yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                {[
                  "Area",
                  "Questions",
                  "Correct",
                  "Incorrect",
                  "Skipped",
                  "Accuracy",
                ].map((label) => (
                  <th className="px-2 py-2" key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  className="border-t"
                  key={`${row.category || ""}:${row.label}`}
                >
                  <th className="px-2 py-2 font-medium" scope="row">
                    {row.category ? `${row.category} / ` : ""}
                    {row.label}
                  </th>
                  {[
                    row.questions,
                    row.correct,
                    row.incorrect,
                    row.skipped,
                    percent(row.accuracy),
                  ].map((value, index) => (
                    <td className="px-2 py-2" key={index}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Activity({ statistics }: { statistics: TeamDashboardData["team"] }) {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  return (
    <section className="space-y-4">
      <h3 className="font-semibold">Practice activity</h3>
      <p className="text-sm text-muted-foreground">
        Dates use {statistics.timeZone}. Weeks start Monday. Showing 30 days, 12
        weeks, or 12 months.
      </p>
      <label>
        Time period
        <select
          aria-label="Time period"
          className="form-select mt-2"
          value={period}
          onChange={(e) => setPeriod(e.target.value as typeof period)}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>
      <Trend rows={statistics.activity[period]} />
      <PerformanceTable
        title={`${period} practice`}
        rows={statistics.activity[period]}
      />
    </section>
  );
}

function Trend({ rows }: { rows: Breakdown[] }) {
  const [metric, setMetric] = useState<"questions" | "accuracy">("questions");
  const [selected, setSelected] = useState("");
  const max =
    metric === "accuracy"
      ? 100
      : Math.max(1, ...rows.map((row) => row.questions));
  const active =
    rows.find((row) => row.label === selected) || rows[rows.length - 1];
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <label>
        Chart metric
        <select
          aria-label="Chart metric"
          className="form-select mt-2"
          value={metric}
          onChange={(e) => setMetric(e.target.value as typeof metric)}
        >
          <option value="questions">Questions</option>
          <option value="accuracy">Accuracy</option>
        </select>
      </label>
      <div
        role="group"
        aria-label="Performance trend chart"
        className="flex h-44 items-end gap-1"
      >
        {rows.map((row) => (
          <button
            type="button"
            key={row.label}
            aria-pressed={active.label === row.label}
            aria-label={`${row.label}: ${row.questions} questions, ${percent(row.accuracy)} accuracy`}
            title={`${row.label}: ${metric === "accuracy" ? percent(row.accuracy) : row.questions}`}
            onClick={() => setSelected(row.label)}
            className="flex h-full min-w-0 flex-1 items-end rounded-sm bg-accent focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span
              className="w-full rounded-sm bg-primary"
              style={{
                height: `${Math.max(2, ((row[metric] || 0) / max) * 100)}%`,
              }}
            />
          </button>
        ))}
      </div>
      <p role="status">
        {active.label}: {active.questions} questions · {active.correct} correct
        · {active.incorrect} incorrect · {percent(active.accuracy)} accuracy
      </p>
    </div>
  );
}

function Heatmap({ cells }: { cells: HeatmapCell[] }) {
  const categories = [...new Set(cells.map((cell) => cell.category))];
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4">
      <h3 className="mb-3 font-semibold">Subject by difficulty heatmap</h3>
      <p className="mb-3 text-sm">
        Darker cells mean higher accuracy. Each cell shows accuracy and answered
        response count; — means no scored responses.
      </p>
      {!categories.length ? (
        <p>No completed practice yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-center text-sm">
            <caption className="sr-only">
              Subject accuracy across difficulties 0 to 10
            </caption>
            <thead>
              <tr>
                <th scope="col" className="p-2 text-left">
                  Subject
                </th>
                {Array.from({ length: 11 }, (_, i) => (
                  <th scope="col" className="p-2" key={i}>
                    {i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category}>
                  <th scope="row" className="p-2 text-left">
                    {category}
                  </th>
                  {Array.from({ length: 11 }, (_, i) => {
                    const cell = cells.find(
                      (c) => c.category === category && c.difficulty === i,
                    );
                    return (
                      <td
                        key={i}
                        className="min-w-20 border p-2"
                        style={{
                          backgroundColor:
                            cell?.accuracy == null
                              ? undefined
                              : `rgba(22,163,74,${0.08 + cell.accuracy * 0.004})`,
                        }}
                      >
                        {percent(cell?.accuracy ?? null)}
                        <span className="block text-xs">
                          n={cell ? cell.correct + cell.incorrect : 0}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function WeakTopics({ rows }: { rows: Breakdown[] }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="mb-2 font-semibold">Areas for improvement</h3>
      <p className="text-sm text-muted-foreground">
        Lowest subcategory accuracies below 70%, with at least three scored
        responses. Skips do not lower accuracy.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3">
          No weak areas with enough evidence yet. Review the subject comparison
          for gaps in practice.
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 py-3"
              key={`${row.category}:${row.label}`}
            >
              <span>
                {row.category} / {row.label}: {percent(row.accuracy)} (
                {row.correct + row.incorrect} scored responses)
              </span>
              <Link
                className="text-sm font-semibold underline"
                href={`/practice?category=${encodeURIComponent(row.category!)}&subcategory=${encodeURIComponent(row.label)}`}
              >
                Open focused practice
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ParticipationTable({
  students,
}: {
  students: TeamDashboardData["students"];
}) {
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  const rows = students.filter(
    (s) =>
      (filter === "all" || s.participation.status === filter) &&
      s.displayName.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Student participation</h2>
      <p className="text-sm text-muted-foreground">
        Active means a saved completed response in the last seven days. Active
        days covers the last 30 calendar days. Sessions count sessions with
        completed responses.
      </p>
      <div className="flex flex-wrap gap-3">
        <label>
          Search students
          <input
            className="form-select mt-2"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Participation filter
          <select
            aria-label="Participation filter"
            className="form-select mt-2"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All students</option>
            <option value="active">Active in last seven days</option>
            <option value="inactive">Inactive for seven days</option>
            <option value="never">No saved practice</option>
          </select>
        </label>
      </div>
      {!rows.length ? (
        <Notice>No students match this filter.</Notice>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Student participation</caption>
            <thead>
              <tr>
                {[
                  "Student",
                  "Status",
                  "Questions",
                  "Correct",
                  "Incorrect",
                  "Accuracy",
                  "Today",
                  "This week",
                  "This month",
                  "Active days",
                  "Sessions",
                  "Last practice",
                ].map((label) => (
                  <th className="p-2" scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr className="border-t" key={s.uid}>
                  <th scope="row" className="p-2">
                    {s.displayName}
                  </th>
                  {[
                    s.participation.status,
                    s.statistics.totalQuestions,
                    s.statistics.total.correct,
                    s.statistics.total.incorrect,
                    percent(s.statistics.total.accuracy),
                    s.statistics.current.daily.questions,
                    s.statistics.current.weekly.questions,
                    s.statistics.current.monthly.questions,
                    s.participation.activeDays,
                    s.participation.sessions,
                    s.participation.lastPracticeAt
                      ? new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeZone: s.statistics.timeZone,
                        }).format(new Date(s.participation.lastPracticeAt))
                      : "Never",
                  ].map((value, i) => (
                    <td className="p-2" key={i}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AssignmentTable({
  students,
}: {
  students: TeamDashboardData["students"];
}) {
  const rows = students.flatMap((student) =>
    student.assignments.map((assignment) => ({
      ...assignment,
      uid: student.uid,
      displayName: student.displayName,
    })),
  );
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Assignment completion</h2>
      <p className="text-sm text-muted-foreground">
        Published assignments addressed to current students. Completion uses
        saved assignment progress; ordinary practice is not automatically
        credited. Assignment creation and automatic progress tracking are task
        10.
      </p>
      {!rows.length ? (
        <Notice>No published assignments for these students.</Notice>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Assignment completion</caption>
            <thead>
              <tr>
                {[
                  "Student",
                  "Assignment",
                  "Progress",
                  "Status",
                  "Deadline",
                ].map((label) => (
                  <th scope="col" className="p-2" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t" key={`${row.uid}:${row.id}`}>
                  <th scope="row" className="p-2">
                    {row.displayName}
                  </th>
                  <td className="p-2">{row.title}</td>
                  <td className="p-2">
                    {row.completedQuestions} /{" "}
                    {row.questionCount || "Not configured"}
                  </td>
                  <td className="p-2">{row.status}</td>
                  <td className="p-2">
                    {row.dueAt
                      ? new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeZone: students[0]?.statistics.timeZone || "UTC",
                        }).format(new Date(row.dueAt))
                      : "No deadline"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StudyTable({ students }: { students: TeamDashboardData["students"] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Deck and review activity</h2>
      <p className="text-sm text-muted-foreground">
        Decks and saved cards are current inventory. Reviews count answer
        reveals in this site&apos;s flashcards since tracking began; Anki
        reviews are not synchronized. Private card contents stay out of this
        dashboard.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Deck and review activity</caption>
          <thead>
            <tr>
              {[
                "Student",
                "Decks",
                "Saved cards",
                "Reviews",
                "Today",
                "This week",
                "This month",
                "Last deck change",
                "Last review",
              ].map((label) => (
                <th scope="col" className="p-2" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr className="border-t" key={s.uid}>
                <th className="p-2" scope="row">
                  {s.displayName}
                </th>
                {[
                  s.study.decks,
                  s.study.savedCards,
                  s.study.reviews,
                  s.study.today,
                  s.study.thisWeek,
                  s.study.thisMonth,
                  ...[s.study.lastDeckChange, s.study.lastReviewAt].map(
                    (date) =>
                      date
                        ? new Intl.DateTimeFormat(undefined, {
                            dateStyle: "medium",
                            timeZone: s.statistics.timeZone,
                          }).format(new Date(date))
                        : "—",
                  ),
                ].map((value, i) => (
                  <td className="p-2" key={i}>
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

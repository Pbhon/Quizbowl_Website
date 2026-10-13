"use client";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "./auth-provider";
import { AccountGuard } from "./account-guard";
import { PageHeading } from "./page-heading";
import { Notice } from "./form-field";
import { Button } from "./ui/button";
import type { Breakdown } from "@/lib/statistics";
import type { TeamDashboardData } from "@/lib/team-dashboard";
import type { TeamMember, HeatmapCell } from "@/lib/team-dashboard";
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
        if (!controller.signal.aborted) setData(body);
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
          <h2 className="text-xl font-semibold">
            Team members ({members.length})
          </h2>
          {members.length === 0 && <Notice>No team members yet.</Notice>}
          <label className="block">
            Statistics for
            <select
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

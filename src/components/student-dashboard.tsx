"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "./auth-provider";
import { AccountGuard } from "./account-guard";
import { PageHeading } from "./page-heading";
import { CalendarPreview } from "./calendar-preview";
import { Notice } from "./form-field";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { Breakdown, DashboardData } from "@/lib/statistics";

const accuracy = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)}%`;
export function StudentDashboard() {
  const { user } = useAuth();
  return (
    <AccountGuard>
      {user && <DashboardWorkspace key={user.uid} user={user} />}
    </AccountGuard>
  );
}
function DashboardWorkspace({ user }: { user: User }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const [metric, setMetric] = useState<"questions" | "attempted" | "accuracy">(
    "questions",
  );
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const token = await user.getIdToken();
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const response = await fetch(
          `/api/dashboard?timeZone=${encodeURIComponent(timeZone)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!controller.signal.aborted) {
          setData(body);
          setError("");
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Your statistics could not be loaded.",
          );
      }
    }
    void load();
    return () => controller.abort();
  }, [user, reload]);
  const refresh = () => {
    setData(null);
    setError("");
    setReload((n) => n + 1);
  };
  if (!data)
    return (
      <div className="space-y-4">
        <PageHeading
          title="Your dashboard"
          description="Your personal practice progress."
        />
        {error ? (
          <>
            <Notice error>{error}</Notice>
            <Button onClick={refresh}>Retry loading statistics</Button>
          </>
        ) : (
          <Notice>Loading your statistics…</Notice>
        )}
      </div>
    );
  const rows = data.activity[period];
  const maximum =
    metric === "accuracy"
      ? 100
      : Math.max(1, ...rows.map((row) => row[metric]));
  const active =
    rows.find((row) => row.label === selected) || rows[rows.length - 1];
  return (
    <div className="space-y-8">
      <CalendarPreview user={user} announcementsOnly />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeading
          title="Your dashboard"
          description="See your progress, find subjects to strengthen, and plan your next practice."
        />
        <Button variant="outline" onClick={refresh}>
          Refresh statistics
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Only practice saved to this account appears here. Each tossup or bonus
        part counts as one response. Accuracy is correct ÷ (correct +
        incorrect); skips and pending clarifications are excluded.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Questions attempted", data.totalQuestions],
          ["Responses completed", data.total.attempted],
          ["Correct responses", data.total.correct],
          ["Incorrect responses", data.total.incorrect],
          ["Overall accuracy", accuracy(data.total.accuracy)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 text-3xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Skipped responses: {data.total.skipped}. Questions attempted counts each
        question once per session, including bonuses with several responses.
      </p>
      {data.total.attempted === 0 && (
        <Notice>
          You have no completed practice responses yet.{" "}
          <Link className="font-semibold underline" href="/practice">
            Start your first session
          </Link>
          .
        </Notice>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {(["daily", "weekly", "monthly"] as const).map((key, i) => (
          <Card key={key}>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">
                {["Today", "This week", "This month"][i]}
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {data.current[key].questions} questions
              </p>
              <p className="mt-1 text-sm">
                {accuracy(data.current[key].accuracy)} accuracy
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Practice progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-4">
            <label className="text-sm">
              Time period
              <select
                className="ml-2 rounded border bg-background p-2"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value as typeof period);
                  setSelected(null);
                }}
              >
                {["daily", "weekly", "monthly"].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Chart metric
              <select
                className="ml-2 rounded border bg-background p-2"
                value={metric}
                onChange={(e) => setMetric(e.target.value as typeof metric)}
              >
                <option value="questions">Questions attempted</option>
                <option value="attempted">Responses attempted</option>
                <option value="accuracy">Accuracy</option>
              </select>
            </label>
          </div>
          <p className="text-sm text-muted-foreground">
            {period === "daily"
              ? "Last 30 days"
              : period === "weekly"
                ? "Last 12 weeks"
                : "Last 12 months"}{" "}
            · {data.timeZone} · Weeks start Monday. Select a bar for details.
          </p>
          <div
            className="flex h-48 items-end gap-1 border-b"
            role="group"
            aria-label="Practice progress chart"
          >
            {rows.map((row) => {
              const value = row[metric] ?? 0;
              return (
                <button
                  key={row.label}
                  className={`group flex h-full min-w-0 flex-1 items-end rounded-t focus-visible:outline-2 focus-visible:outline-primary ${row.label === active.label ? "bg-accent" : "hover:bg-muted"}`}
                  aria-label={`${row.label}: ${row.questions} questions, ${row.attempted} responses, ${accuracy(row.accuracy)} accuracy`}
                  aria-pressed={row.label === active.label}
                  title={`${row.label}: ${metric === "accuracy" ? accuracy(row.accuracy) : row[metric]}`}
                  onClick={() => setSelected(row.label)}
                >
                  <span
                    className="w-full rounded-t bg-primary"
                    style={{
                      height: `${Math.max(2, (value / maximum) * 100)}%`,
                      opacity: value ? 1 : 0.2,
                    }}
                  />
                </button>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{rows[0].label}</span>
            <span>{rows[rows.length - 1].label}</span>
          </div>
          <p role="status" className="text-sm">
            {active.label}: {active.questions} questions · {active.attempted}{" "}
            responses · {active.correct} correct · {active.incorrect} incorrect
            · {active.skipped} skipped · {accuracy(active.accuracy)} accuracy
          </p>
        </CardContent>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2 *:min-w-0">
        <PerformanceTable title="Accuracy by category" rows={data.categories} />
        <PerformanceTable
          title="Accuracy by subcategory"
          rows={data.subcategories}
        />
        <PerformanceTable
          title="Performance by difficulty"
          rows={data.difficulties}
        />
        <Card>
          <CardHeader>
            <CardTitle>Subjects to practice</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Your lowest subcategory accuracies below 70%, with at least three
              answered responses.
            </p>
            {data.recommendations.length ? (
              data.recommendations.map((row) => (
                <div
                  key={`${row.category}:${row.label}`}
                  className="border-t pt-3"
                >
                  <p className="font-medium">{row.label}</p>
                  <p className="text-sm text-muted-foreground">
                    {row.category} · {accuracy(row.accuracy)} from{" "}
                    {row.correct + row.incorrect} answered responses
                  </p>
                  <Link
                    className="text-sm font-semibold text-primary underline"
                    href={`/practice?category=${encodeURIComponent(row.category!)}&subcategory=${encodeURIComponent(row.label)}`}
                  >
                    Practice this subject
                  </Link>
                </div>
              ))
            ) : (
              <p className="text-sm">
                Keep practicing across subjects to reveal areas for improvement.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2 *:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Recent practice sessions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.sessions.length ? (
              data.sessions.map((session) => (
                <div key={session.id} className="border-t pt-3">
                  <p className="font-medium">
                    {new Date(session.createdAt).toLocaleString()} ·{" "}
                    {session.completed
                      ? "Completed"
                      : session.attemptedParts
                        ? "In progress"
                        : "Not started"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {session.questionCount} questions · {session.attemptedParts}
                    /{session.totalParts} responses · {session.correct} correct
                    · {session.incorrect} incorrect · {session.skipped} skipped
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm">No saved practice sessions yet.</p>
            )}
            <Button asChild variant="outline">
              <Link href="/practice">Start a new session</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Upcoming assignments and team events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.upcoming.length ? (
              data.upcoming.map((item) => (
                <div className="border-t pt-3" key={item.id}>
                  <Link
                    className="font-medium text-primary underline"
                    href={
                      item.kind === "assignment" ? "/assignments" : "/calendar"
                    }
                  >
                    {item.title}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {item.kind === "assignment"
                      ? "Assignment due"
                      : item.kind === "practice"
                        ? "Team practice"
                        : item.kind === "competition"
                          ? "Competition"
                          : "Team event"}{" "}
                    · {new Date(item.date).toLocaleString()}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm">
                No upcoming assignments or team events have been published for
                you.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
function PerformanceTable({
  title,
  rows,
}: {
  title: string;
  rows: Breakdown[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr className="border-b">
                  {[
                    "Subject / level",
                    "Responses",
                    "Correct",
                    "Incorrect",
                    "Skipped",
                    "Accuracy",
                  ].map((label) => (
                    <th className="p-2 font-medium" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    className="border-b"
                    key={`${row.category || ""}:${row.label}`}
                  >
                    <th scope="row" className="p-2 font-medium">
                      {row.label}
                      {row.category && (
                        <span className="block text-xs text-muted-foreground">
                          {row.category}
                        </span>
                      )}
                    </th>
                    <td className="p-2">{row.attempted}</td>
                    <td className="p-2">{row.correct}</td>
                    <td className="p-2">{row.incorrect}</td>
                    <td className="p-2">{row.skipped}</td>
                    <td className="p-2">{accuracy(row.accuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Practice a few questions to see your performance here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

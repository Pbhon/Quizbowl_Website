"use client";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "./auth-provider";
import { AccountGuard } from "./account-guard";
import { PageHeading } from "./page-heading";
import { Notice } from "./form-field";
import { Button } from "./ui/button";
import type { TeamDashboardData } from "@/lib/team-dashboard";
export type TeamMember = {
  uid: string;
  displayName: string;
  role: "student" | "teacher" | "admin";
};
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

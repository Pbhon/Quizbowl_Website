"use client";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "./auth-provider";
import { AccountGuard } from "./account-guard";
import { PageHeading } from "./page-heading";
import { Notice } from "./form-field";
import { Button } from "./ui/button";
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
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/team/dashboard", {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!controller.signal.aborted) setMembers(body.members);
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
          setMembers(null);
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
          <ul className="divide-y">
            {members.map((member) => (
              <li
                className="flex flex-wrap justify-between gap-2 py-3"
                key={member.uid}
              >
                <span>{member.displayName}</span>
                <span>{member.role}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

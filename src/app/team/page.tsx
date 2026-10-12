"use client";
import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { Users } from "lucide-react";
import { AccountGuard } from "@/components/account-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeading } from "@/components/page-heading";
import { Notice } from "@/components/form-field";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { getFirebase } from "@/lib/firebase/client";
import { teamName } from "@/lib/team";
function Roster() {
  const { access } = useAuth();
  const [members, setMembers] = useState<{ id: string; displayName: string }[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(
    () =>
      onSnapshot(
        collection(getFirebase().db, "teams", access.teamId!, "members"),
        (snapshot) => {
          setMembers(
            snapshot.docs
              .map((member) => ({
                id: member.id,
                displayName: member.data().displayName || "Team member",
              }))
              .sort((a, b) => a.displayName.localeCompare(b.displayName)),
          );
          setLoading(false);
          setError(false);
        },
        () => {
          setError(true);
          setLoading(false);
        },
      ),
    [access.teamId],
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users size={20} aria-hidden />
          Team members
        </CardTitle>
        <CardDescription>
          Everyone who signs in to this school’s site joins {teamName}{" "}
          automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <Notice error>
            Your team could not be loaded. Check your connection and retry.
          </Notice>
        ) : loading ? (
          <Notice>Loading team members…</Notice>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              {members.length} {members.length === 1 ? "member" : "members"}
            </p>
            <ul className="divide-y">
              {members.map((member) => (
                <li key={member.id} className="flex items-center gap-3 py-4">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-medium text-primary"
                    aria-hidden
                  >
                    {member.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 break-words text-sm font-medium">
                    {member.displayName}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
export default function TeamPage() {
  const { access } = useAuth();
  return (
    <AccountGuard staff>
      <div className="space-y-8">
        <PageHeading
          eyebrow={teamName}
          title="Team access"
          description="Your school's quizbowl workspace. Students join automatically when they sign in, and your roster stays separate from other schools."
        />
        <Roster key={access.teamId} />
      </div>
    </AccountGuard>
  );
}

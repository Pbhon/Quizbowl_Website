"use client";

import { useState } from "react";
import { UserRound, Users } from "lucide-react";
import Link from "next/link";
import { AccountGuard } from "@/components/account-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeading } from "@/components/page-heading";
import { FormField, Notice } from "@/components/form-field";
import { VerificationPanel } from "@/components/verification-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { grades, roleLabels, type Profile } from "@/lib/accounts";
import { saveProfile } from "@/lib/firebase/profiles";
import { accountError } from "@/lib/firebase/errors";

import { teamName } from "@/lib/team";

function ProfileForm({ profile }: { profile: Profile }) {
  const { user, access } = useAuth();
  const [name, setName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio || "");
  const [grade, setGrade] = useState(profile.grade || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSaved(false);
    if (!name.trim()) {
      setError("Enter your name.");
      return;
    }
    setBusy(true);
    try {
      await saveProfile(
        user!.uid,
        {
          displayName: name.trim(),
          bio: bio.trim(),
          grade,
        },
        access.teamId,
      );
      setSaved(true);
    } catch (cause) {
      setError(accountError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={busy} className="space-y-5">
        <FormField id="displayName" label="Display name">
          <Input
            id="displayName"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            autoComplete="name"
            required
            maxLength={80}
          />
        </FormField>
        <FormField id="grade" label="Grade / level">
          <select
            id="grade"
            className="form-select"
            value={grade}
            onChange={(event) => {
              setGrade(event.target.value);
              setSaved(false);
            }}
          >
            {grades.map((value) => (
              <option key={value} value={value}>
                {value === ""
                  ? "Prefer not to say"
                  : value === "college"
                    ? "College"
                    : value === "other"
                      ? "Other"
                      : "Grade " + value}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          id="bio"
          label="About you"
          hint="Optional. Share your favorite subjects or what you’re studying."
        >
          <textarea
            id="bio"
            className="form-textarea"
            value={bio}
            onChange={(event) => {
              setBio(event.target.value);
              setSaved(false);
            }}
            maxLength={300}
            rows={4}
            aria-describedby="bio-hint"
          />
        </FormField>
        <Button type="submit">{busy ? "Saving…" : "Save profile"}</Button>
      </fieldset>
      {saved && <Notice>Profile saved.</Notice>}
      {error && <Notice error>{error}</Notice>}
    </form>
  );
}

export default function ProfilePage() {
  const { user, profile, access } = useAuth();
  return (
    <AccountGuard>
      <div className="space-y-8">
        <PageHeading
          eyebrow="Your account"
          title="Your profile"
          description="Make this workspace yours. Your display name appears throughout your account."
        />
        <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound size={20} aria-hidden />
                Profile details
              </CardTitle>
              <CardDescription>
                Your bio and grade stay private. Staff can see your display name
                in the school roster.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {profile && <ProfileForm key={user?.uid} profile={profile} />}
            </CardContent>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Account & team</CardTitle>
                <CardDescription className="break-all">
                  {user?.email}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <span className="badge">{roleLabels[access.role]}</span>
                <p className="text-sm leading-6 text-muted-foreground">
                  {access.teamId
                    ? "Connected to " + teamName
                    : "Your school membership is loading. Retry if your connection was interrupted."}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild variant="outline">
                    <Link href="/settings">Account settings</Link>
                  </Button>
                  {access.role !== "student" && (
                    <Button asChild variant="outline">
                      <Link href="/team">
                        <Users />
                        Team access
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            <VerificationPanel />
          </div>
        </div>
      </div>
    </AccountGuard>
  );
}

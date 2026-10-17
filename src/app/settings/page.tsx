"use client";

import { useState } from "react";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
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
import { defaultPreferences, type Preferences } from "@/lib/accounts";
import { savePreferences } from "@/lib/firebase/profiles";
import { accountError } from "@/lib/firebase/errors";
import { AccountPrivacy } from "@/components/account-privacy";

function PreferencesForm({ initial }: { initial: Preferences }) {
  const { user } = useAuth();
  const [theme, setTheme] = useState(initial.theme);
  const [reducedMotion, setReducedMotion] = useState(initial.reducedMotion);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await savePreferences(user!.uid, { theme, reducedMotion });
      setMessage("Preferences saved.");
    } catch (cause) {
      setError(accountError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="space-y-5" onSubmit={submit}>
      <fieldset disabled={busy} className="space-y-5">
        <FormField id="theme" label="Appearance">
          <select
            id="theme"
            className="form-select"
            value={theme}
            onChange={(event) => {
              setTheme(event.target.value as Preferences["theme"]);
              setMessage("");
            }}
          >
            <option value="system">Use device setting</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </FormField>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={reducedMotion}
            onChange={(event) => {
              setReducedMotion(event.target.checked);
              setMessage("");
            }}
          />
          Reduce motion
        </label>
        <p className="text-sm leading-6 text-muted-foreground">
          These preferences apply across your workspace and stay with your
          account.
        </p>
        <Button type="submit">{busy ? "Saving…" : "Save preferences"}</Button>
      </fieldset>
      {message && <Notice>{message}</Notice>}
      {error && <Notice error>{error}</Notice>}
    </form>
  );
}
function PasswordForm() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    setMessage("");
    if (data.get("newPassword") !== data.get("confirmPassword")) {
      setError("The new passwords don’t match.");
      return;
    }
    setBusy(true);
    try {
      await reauthenticateWithCredential(
        user!,
        EmailAuthProvider.credential(
          user!.email!,
          String(data.get("currentPassword")),
        ),
      );
      await updatePassword(user!, String(data.get("newPassword")));
      form.reset();
      setMessage("Password updated.");
    } catch (cause) {
      setError(accountError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={busy} className="space-y-5">
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={user?.email || ""}
          readOnly
          hidden
        />
        <FormField id="currentPassword" label="Current password">
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </FormField>
        <FormField
          id="newPassword"
          label="New password"
          hint="Use at least 8 characters."
        >
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </FormField>
        <FormField id="confirmPassword" label="Confirm new password">
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </FormField>
        <Button type="submit">{busy ? "Updating…" : "Update password"}</Button>
      </fieldset>
      {message && <Notice>{message}</Notice>}
      {error && <Notice error>{error}</Notice>}
    </form>
  );
}
export default function SettingsPage() {
  const { user, profile } = useAuth();
  return (
    <AccountGuard>
      <div className="space-y-8">
        <PageHeading
          eyebrow="Your account"
          title="Account settings"
          description="Choose how your workspace looks and keep your sign-in details secure."
        />
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Workspace preferences</CardTitle>
              <CardDescription>
                Set things up for the way you study.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {profile && (
                <PreferencesForm
                  key={user?.uid}
                  initial={profile.preferences || defaultPreferences}
                />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Change password</CardTitle>
              <CardDescription>
                Confirm your current password to make a change.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PasswordForm />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Privacy and your data</CardTitle>
          </CardHeader>
          <CardContent>
            <AccountPrivacy key={user?.uid} />
          </CardContent>
        </Card>
        <VerificationPanel />
      </div>
    </AccountGuard>
  );
}

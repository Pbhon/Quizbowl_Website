"use client";
import { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { FormField, Notice } from "./form-field";
import { accountError } from "@/lib/firebase/errors";
export function AccountPrivacy() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user?.email) return;
    const form = event.currentTarget;
    const password = String(new FormData(form).get("privacyPassword") || "");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await reauthenticateWithCredential(
        user,
        EmailAuthProvider.credential(user.email, password),
      );
      const token = await user.getIdToken(true);
      const response = await fetch("/api/account/data", {
        method: confirm ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(confirm ? { "Content-Type": "application/json" } : {}),
        },
        ...(confirm
          ? { body: JSON.stringify({ action: "request-deletion" }) }
          : {}),
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).error || "Your data request failed.",
        );
      if (confirm) {
        setMessage(
          "Deletion requested. Your school operator must process it; your data remains until processing finishes.",
        );
        setConfirm(false);
      } else {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = "quizbowl-account-data.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("Your account data was downloaded.");
      }
      form.reset();
    } catch (cause) {
      setError(
        cause && typeof cause === "object" && "code" in cause
          ? accountError(cause)
          : cause instanceof Error
            ? cause.message
            : "Your data request failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Your answers and personal decks are private. Current school staff can
        view your practice statistics and assignment progress. Shared decks are
        visible to school members. AI generation sends original question text
        and official answers to Gemini when explicitly requested; your profile,
        notes and submitted answers are excluded.
      </p>
      <p className="text-sm text-muted-foreground">
        Practice history is kept until your school operator applies its
        retention policy. Download a copy or request account deletion below.
        Contact your school operator about retention, deletion timing or
        previously downloaded copies.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          <FormField
            id="privacyPassword"
            label="Current password for data requests"
          >
            <Input
              id="privacyPassword"
              name="privacyPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </FormField>
          {confirm && (
            <Notice>
              Confirm that you want your account and personal data deleted. Your
              school operator will process this request. Completed deletion
              cannot be undone. Shared copies and school-authored material may
              remain.
            </Notice>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit">
              {busy
                ? "Working…"
                : confirm
                  ? "Confirm deletion request"
                  : "Download my data"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirm(!confirm);
                setMessage("");
                setError("");
              }}
            >
              {confirm ? "Cancel" : "Request account deletion"}
            </Button>
          </div>
        </fieldset>
        {message && <Notice>{message}</Notice>}
        {error && <Notice error>{error}</Notice>}
      </form>
    </div>
  );
}

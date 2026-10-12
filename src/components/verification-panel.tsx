"use client";

import { useState } from "react";
import { sendEmailVerification } from "firebase/auth";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Notice } from "./form-field";
import { accountError } from "@/lib/firebase/errors";

export function VerificationPanel() {
  const { user, refresh } = useAuth();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!user || user.emailVerified) return null;
  async function action(send: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (send) {
        await sendEmailVerification(user!);
        setMessage(
          "Verification email sent. Check your inbox and spam folder, then refresh your verification below.",
        );
      } else {
        await refresh();
        if (!user!.emailVerified)
          setMessage(
            "Your email is still unverified. Open the verification link, then try again.",
          );
      }
    } catch (cause) {
      setError(accountError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify your email</CardTitle>
        <CardDescription className="leading-6">
          Confirm {user.email} to secure your account and use staff tools.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy} onClick={() => action(true)}>
            Send verification email
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => action(false)}
          >
            Refresh verification
          </Button>
        </div>
        {message && <Notice>{message}</Notice>}
        {error && <Notice error>{error}</Notice>}
      </CardContent>
    </Card>
  );
}

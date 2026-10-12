"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { Notice } from "./form-field";
import { VerificationPanel } from "./verification-panel";

export function AccountGuard({
  children,
  staff = false,
}: {
  children: React.ReactNode;
  staff?: boolean;
}) {
  const { user, loading, error, access, refresh } = useAuth();
  const [retryError, setRetryError] = useState("");
  if (loading) return <Notice>Loading your workspace…</Notice>;
  if (!user)
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl">Sign in to continue</h1>
          </CardTitle>
          <CardDescription>
            Your account keeps your workspace private.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  if (error)
    return (
      <div className="space-y-4">
        <Notice error>{error}</Notice>
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await refresh();
            } catch {
              setRetryError("Unable to reconnect. Please try again.");
            }
          }}
        >
          Retry loading account
        </Button>
        {retryError && <Notice error>{retryError}</Notice>}
      </div>
    );
  if (staff && !user.emailVerified) return <VerificationPanel />;
  if (staff && access.role === "student")
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl">Staff access required</h1>
          </CardTitle>
          <CardDescription>
            This page is available to teachers and administrators assigned by
            your project administrator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/profile">View your profile</Link>
          </Button>
        </CardContent>
      </Card>
    );
  return children;
}

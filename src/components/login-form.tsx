"use client";

import Link from "next/link";
import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { GraduationCap, ShieldCheck } from "lucide-react";
import { useAuth } from "./auth-provider";
import { getFirebase } from "@/lib/firebase/client";
import { ensureProfile, saveProfile } from "@/lib/firebase/profiles";
import { accountError } from "@/lib/firebase/errors";
import { roleLabels } from "@/lib/accounts";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { FormField, Notice } from "./form-field";
import { VerificationPanel } from "./verification-panel";

import { teamName } from "@/lib/team";

type Mode = "login" | "register" | "admin-register" | "reset";
export function LoginForm() {
  const {
    configured,
    user,
    profile,
    access,
    loading,
    error: authError,
  } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [staff, setStaff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const registering = mode === "register" || mode === "admin-register";
  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setMessage("");
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || user || !configured || busy) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email")).trim();
    const password = String(data.get("password"));
    const name = String(data.get("name") || "").trim();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { auth } = getFirebase();
      if (mode === "reset") {
        await sendPasswordResetEmail(auth, email);
        setMessage(
          "If an account exists for this email, you’ll receive a password reset link.",
        );
        return;
      }
      if (registering && !name) throw new Error("Enter your name.");
      if (mode === "admin-register") {
        const response = await fetch("/api/auth/admin-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            name,
            code: String(data.get("adminCode") || ""),
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.message || "Admin registration is unavailable.",
          );
        // The account now exists even if the following sign-in loses its connection.
        setMode("login");
        setMessage(
          "Your administrator account was created. Sign in if the connection is interrupted.",
        );
      }
      const credential =
        mode === "register"
          ? await createUserWithEmailAndPassword(auth, email, password)
          : await signInWithEmailAndPassword(auth, email, password);
      if (mode === "register") {
        await updateProfile(credential.user, { displayName: name });
        await ensureProfile(credential.user.uid, name);
        await saveProfile(credential.user.uid, {
          displayName: name,
          bio: "",
          grade: "",
        });
        await credential.user.getIdToken(true);
      }
      if (registering) {
        try {
          await sendEmailVerification(credential.user);
        } catch {
          setVerificationError(
            "Your account was created, but the verification email could not be sent. Use the button below to retry.",
          );
        }
      }
    } catch (cause) {
      setError(accountError(cause));
    } finally {
      setBusy(false);
    }
  }
  const destination = "/profile";
  if (loading)
    return (
      <div className="mx-auto max-w-lg">
        <Notice>Checking your session…</Notice>
      </div>
    );
  return (
    <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1fr_1.05fr] lg:items-start">
      <div className="space-y-5 py-3 lg:py-10">
        <span className="inline-flex rounded-2xl bg-accent p-3 text-primary">
          <GraduationCap size={30} aria-hidden />
        </span>
        <p className="eyebrow">Learn together. Go further.</p>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {user
            ? "Your workspace is ready."
            : "A little curiosity goes a long way."}
        </h1>
        <p className="max-w-md leading-7 text-muted-foreground">
          Sign in to join {teamName} automatically. Your school has its own
          quizbowl workspace, with no student join code or invitation needed.
        </p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck size={18} aria-hidden />
          Your bio and account preferences stay private.
        </p>
      </div>
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">
              {user
                ? "You’re signed in"
                : registering
                  ? "Create your account"
                  : mode === "reset"
                    ? "Reset your password"
                    : "Welcome back"}
            </CardTitle>
            <CardDescription>
              {user ? user.email : "Your school workspace starts here."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!configured && (
              <Notice>
                Authentication is waiting for Firebase configuration. Add the
                project’s web app settings to .env.local to enable sign in.
              </Notice>
            )}
            {authError && <Notice error>{authError}</Notice>}
            {error && <Notice error>{error}</Notice>}
            {message && <Notice>{message}</Notice>}
            {verificationError && <Notice error>{verificationError}</Notice>}
            {user ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {profile?.displayName || user.displayName} ·{" "}
                  {roleLabels[access.role]}
                </p>
                {staff && access.role === "student" && user.emailVerified && (
                  <Notice error>
                    Staff access hasn’t been assigned to this account. Contact
                    your project administrator.
                  </Notice>
                )}
                <Button asChild className="w-full">
                  <Link href={destination}>Manage your profile</Link>
                </Button>
                {access.role !== "student" && (
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/team">Open team access</Link>
                  </Button>
                )}
              </>
            ) : (
              <>
                <div
                  className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
                  role="group"
                  aria-label="Account type"
                >
                  <Button
                    variant={!staff ? "outline" : "ghost"}
                    disabled={busy}
                    aria-pressed={!staff}
                    onClick={() => {
                      setStaff(false);
                      switchMode("login");
                    }}
                  >
                    Student
                  </Button>
                  <Button
                    variant={staff ? "outline" : "ghost"}
                    disabled={busy}
                    aria-pressed={staff}
                    onClick={() => {
                      setStaff(true);
                      switchMode("login");
                    }}
                  >
                    Teacher / Admin
                  </Button>
                </div>
                {staff && (
                  <p className="text-sm leading-6 text-muted-foreground">
                    Use your assigned staff account. Your permissions come from
                    your team administrator.
                  </p>
                )}
                <form onSubmit={submit} className="space-y-5">
                  <fieldset
                    disabled={!configured || busy}
                    className="space-y-5 disabled:opacity-60"
                  >
                    {registering && (
                      <FormField id="name" label="Name">
                        <Input
                          id="name"
                          name="name"
                          autoComplete="name"
                          required
                          maxLength={80}
                        />
                      </FormField>
                    )}
                    <FormField id="email" label="Email">
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={254}
                      />
                    </FormField>
                    {mode !== "reset" && (
                      <FormField
                        id="password"
                        label="Password"
                        hint={
                          registering ? "Use at least 8 characters." : undefined
                        }
                      >
                        <Input
                          id="password"
                          name="password"
                          type="password"
                          minLength={registering ? 8 : undefined}
                          maxLength={registering ? 128 : undefined}
                          autoComplete={
                            registering ? "new-password" : "current-password"
                          }
                          required
                        />
                      </FormField>
                    )}
                    {mode === "admin-register" && (
                      <FormField
                        id="adminCode"
                        label="Administrator code"
                        hint="Ask your project administrator for the private signup code."
                      >
                        <Input
                          id="adminCode"
                          name="adminCode"
                          type="password"
                          autoComplete="off"
                          required
                          maxLength={256}
                          aria-describedby="adminCode-hint"
                        />
                      </FormField>
                    )}
                    <Button type="submit" className="w-full">
                      {busy
                        ? "Connecting…"
                        : registering
                          ? mode === "admin-register"
                            ? "Create admin account"
                            : "Create account"
                          : mode === "reset"
                            ? "Send reset link"
                            : "Sign in"}
                    </Button>
                  </fieldset>
                </form>
                <div className="space-y-2">
                  {mode !== "reset" && (
                    <Button
                      variant="ghost"
                      className="h-auto w-full whitespace-normal py-2"
                      disabled={busy}
                      onClick={() =>
                        switchMode(
                          registering
                            ? "login"
                            : staff
                              ? "admin-register"
                              : "register",
                        )
                      }
                    >
                      {registering
                        ? "Already have an account? Sign in"
                        : staff
                          ? "Create an admin account"
                          : "New here? Create an account"}
                    </Button>
                  )}
                  <Button
                    variant="link"
                    className="w-full"
                    disabled={busy}
                    onClick={() =>
                      switchMode(mode === "reset" ? "login" : "reset")
                    }
                  >
                    {mode === "reset"
                      ? "Back to sign in"
                      : "Forgot your password?"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        {user && <VerificationPanel />}
      </div>
    </div>
  );
}

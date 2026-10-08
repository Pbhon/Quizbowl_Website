"use client";

import { useState } from "react";
import { FirebaseError } from "firebase/app";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "firebase/auth";
import { useAuth } from "@/components/auth-provider";
import { getFirebase } from "@/lib/firebase/client";
import { ensureProfile } from "@/lib/firebase/profiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function Login() {
  const { configured, user, loading, error: authError } = useAuth();
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    if (loading || user || !configured || busy) { event.preventDefault(); return; }
    event.preventDefault(); setBusy(true); setError(null); setProfileError(false);
    const data = new FormData(event.currentTarget);
    try {
      const email = String(data.get("email")).trim();
      const password = String(data.get("password"));
      const name = String(data.get("name") || "QuizBowl student").trim();
      if (!name) throw new Error("Enter your name.");
      const { auth } = getFirebase();
      const credential = register ? await createUserWithEmailAndPassword(auth, email, password) : await signInWithEmailAndPassword(auth, email, password);
      if (register) await updateProfile(credential.user, { displayName: name });
      try { await ensureProfile(credential.user.uid, credential.user.displayName || name); } catch { setProfileError(true); }
    } catch (cause) {
      const code = cause instanceof FirebaseError ? cause.code : "";
      const messages: Record<string,string> = {
        "auth/invalid-credential": "Unable to sign in with those credentials.",
        "auth/email-already-in-use": "Unable to create this account. Try signing in instead.",
        "auth/weak-password": "Choose a stronger password with at least 6 characters.",
        "auth/too-many-requests": "Too many attempts. Please try again later.",
        "auth/network-request-failed": "Connection failed. Check your connection and try again.",
      };
      setError(messages[code] || "Unable to authenticate. Check your details and Firebase setup.");
    } finally { setBusy(false); }
  }
  if (loading) return <Card className="mx-auto max-w-md"><CardContent><p role="status" className="py-6 text-sm text-muted-foreground">Checking your session…</p></CardContent></Card>;
  return <Card className="mx-auto max-w-md"><CardHeader><CardTitle className="text-2xl">{user ? "You’re signed in" : register ? "Create your account" : "Welcome back"}</CardTitle><CardDescription>{user ? user.email : "Your team workspace starts here."}</CardDescription></CardHeader><CardContent>
    {!configured && <p role="status" className="mb-6 rounded-lg bg-accent p-4 text-sm leading-6">Authentication is waiting for Firebase configuration. Add the project’s web app settings to .env.local to enable sign in.</p>}
    {authError && <p role="alert" className="mb-4 text-sm text-destructive">{authError}</p>}
    {profileError && <p role="alert" className="mb-4 text-sm text-destructive">You are signed in, but your profile could not be saved. Check Firestore setup, then sign out and sign in to retry.</p>}
    {user ? <p className="text-sm leading-6">Your account is connected. Team features will be added in the next project phases.</p> : <form onSubmit={submit} className="space-y-5"><fieldset disabled={!configured || loading || busy} className="space-y-5 disabled:opacity-60">{register && <div className="space-y-2"><label htmlFor="name" className="text-sm font-medium">Name</label><Input id="name" name="name" autoComplete="name" required maxLength={80} /></div>}<div className="space-y-2"><label htmlFor="email" className="text-sm font-medium">Email</label><Input id="email" name="email" type="email" autoComplete="email" required /></div><div className="space-y-2"><label htmlFor="password" className="text-sm font-medium">Password</label><Input id="password" name="password" type="password" minLength={6} autoComplete={register ? "new-password" : "current-password"} required /></div><Button type="submit" className="w-full">{busy ? "Connecting…" : register ? "Create account" : "Sign in"}</Button></fieldset>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={() => { setRegister(!register); setError(null); }}>{register ? "Already have an account? Sign in" : "New here? Create an account"}</Button></form>}
  </CardContent></Card>;
}

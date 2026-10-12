"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onIdTokenChanged, reload, signOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { firebaseConfigured, getFirebase } from "@/lib/firebase/client";
import { ensureProfile } from "@/lib/firebase/profiles";
import { defaultPreferences, type Access, type Profile } from "@/lib/accounts";

type Session = {
  user: User | null;
  profile: Profile | null;
  access: Access;
  loading: boolean;
  error: string | null;
};
const emptySession: Session = {
  user: null,
  profile: null,
  access: { role: "student", teamId: null },
  loading: false,
  error: null,
};
const AuthContext = createContext<
  Session & {
    configured: boolean;
    logout: () => Promise<void>;
    refresh: () => Promise<void>;
  }
>({
  ...emptySession,
  configured: firebaseConfigured,
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>({
    ...emptySession,
    loading: firebaseConfigured,
  });
  useEffect(() => {
    if (!firebaseConfigured) return;
    let generation = 0;
    let activeUid: string | null = null;
    let accountReady = false;
    let stops: (() => void)[] = [];
    let stopAuth = () => {};
    try {
      const { auth, db } = getFirebase();
      stopAuth = onIdTokenChanged(
        auth,
        async (current) => {
          const preserveAccount =
            current !== null && current.uid === activeUid && accountReady;
          activeUid = current?.uid || null;
          if (!preserveAccount) accountReady = false;
          const ticket = ++generation;
          stops.forEach((stop) => stop());
          stops = [];
          if (!current) {
            setSession(emptySession);
            return;
          }
          // Reauthentication refreshes tokens during password changes. Keep the
          // current forms mounted so their values and completion notices survive.
          if (preserveAccount)
            setSession((previous) => ({ ...previous, user: current }));
          else setSession({ ...emptySession, user: current, loading: true });
          try {
            await ensureProfile(
              current.uid,
              current.displayName || "QuizBowl student",
            );
            const response = await fetch("/api/auth/team-session", {
              method: "POST",
              headers: {
                Authorization: "Bearer " + (await current.getIdToken()),
              },
            });
            if (!response.ok) throw new Error("School membership unavailable");
            const { teamId: schoolId } = await response.json();
            if (ticket !== generation) return;
            let profile: Profile | null = null;
            let staff: Access | null = null;
            let teamId: string | null = null;
            const ready = new Set<string>();
            let failure = false;
            const publish = () => {
              if (
                !failure &&
                ticket === generation &&
                (!preserveAccount || ready.size === 3)
              ) {
                if (ready.size === 3) accountReady = true;
                setSession({
                  user: current,
                  profile,
                  access: staff || { role: "student", teamId },
                  loading: !preserveAccount && ready.size < 3,
                  error: null,
                });
              }
            };
            const failed = () => {
              failure = true;
              accountReady = false;
              if (ticket === generation)
                setSession({
                  ...emptySession,
                  user: current,
                  error:
                    "Your account data could not be loaded. Check your connection, then retry.",
                });
            };
            stops = [
              onSnapshot(
                doc(db, "users", current.uid),
                (snapshot) => {
                  profile = snapshot.exists()
                    ? (snapshot.data() as Profile)
                    : null;
                  ready.add("profile");
                  publish();
                },
                failed,
              ),
              onSnapshot(
                doc(db, "staff", current.uid),
                (snapshot) => {
                  const data = snapshot.data();
                  staff =
                    current.emailVerified &&
                    data &&
                    ["teacher", "admin"].includes(data.role) &&
                    typeof data.teamId === "string" &&
                    data.teamId === schoolId
                      ? { role: data.role, teamId: data.teamId }
                      : null;
                  ready.add("staff");
                  publish();
                },
                failed,
              ),
              onSnapshot(
                doc(db, "teams", schoolId, "members", current.uid),
                (snapshot) => {
                  teamId = snapshot.exists() ? schoolId : null;
                  ready.add("membership");
                  publish();
                },
                failed,
              ),
            ];
          } catch {
            if (ticket === generation)
              setSession({
                ...emptySession,
                user: current,
                error:
                  "Your school workspace could not be loaded. Check your connection, then retry.",
              });
          }
        },
        () =>
          setSession({
            ...emptySession,
            error: "Authentication is unavailable. Please try again.",
          }),
      );
    } catch {
      queueMicrotask(() =>
        setSession({
          ...emptySession,
          error:
            "Authentication is unavailable. Check your Firebase configuration.",
        }),
      );
    }
    return () => {
      generation++;
      stopAuth();
      stops.forEach((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const preferences = session.profile?.preferences || defaultPreferences;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : preferences.theme;
      document.documentElement.dataset.reducedMotion = String(
        preferences.reducedMotion,
      );
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [session.profile?.preferences]);

  async function refresh() {
    const user = getFirebase().auth.currentUser;
    if (user) {
      await reload(user);
      await user.getIdToken(true);
    }
  }

  return (
    <AuthContext.Provider
      value={{
        ...session,
        configured: firebaseConfigured,
        logout: () => signOut(getFirebase().auth),
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  return useContext(AuthContext);
}

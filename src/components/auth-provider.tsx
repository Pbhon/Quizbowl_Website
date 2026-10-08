"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebaseConfigured, getFirebase } from "@/lib/firebase/client";

const AuthContext = createContext<{ user: User | null; loading: boolean; configured: boolean; error: string | null; logout: () => Promise<void> }>({
  user: null, loading: true, configured: firebaseConfigured, error: null, logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(firebaseConfigured);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!firebaseConfigured) return;
    try {
      return onAuthStateChanged(getFirebase().auth, (current) => {
        setUser(current);
        setLoading(false);
      }, () => { setError("Authentication is unavailable. Check your Firebase configuration."); setLoading(false); });
    } catch {
      // Configuration failures are surfaced without exposing credentials.
      queueMicrotask(() => { setError("Authentication is unavailable. Check your Firebase configuration."); setLoading(false); });
    }
  }, []);
  return <AuthContext.Provider value={{ user, loading, configured: firebaseConfigured, error, logout: () => signOut(getFirebase().auth) }}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }

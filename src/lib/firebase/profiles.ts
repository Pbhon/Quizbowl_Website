"use client";

import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirebase } from "./client";

export async function ensureProfile(uid: string, displayName: string) {
  const reference = doc(getFirebase().db, "users", uid);
  if (!(await getDoc(reference)).exists()) {
    await setDoc(reference, { displayName, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
}

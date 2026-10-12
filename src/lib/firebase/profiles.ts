"use client";

import {
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { defaultPreferences, type Profile } from "@/lib/accounts";
import { getFirebase } from "./client";

export async function ensureProfile(uid: string, displayName: string) {
  const reference = doc(getFirebase().db, "users", uid);
  await runTransaction(getFirebase().db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) {
      transaction.set(reference, {
        displayName: displayName.trim().slice(0, 80) || "QuizBowl student",
        bio: "",
        grade: "",
        preferences: defaultPreferences,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (!snapshot.data().preferences) {
      // Preserve profiles created during the initial setup.
      transaction.update(reference, {
        bio: "",
        grade: "",
        preferences: defaultPreferences,
        updatedAt: serverTimestamp(),
      });
    }
  });
}

export function saveProfile(
  uid: string,
  fields: Pick<Profile, "displayName" | "bio" | "grade">,
  teamId?: string | null,
) {
  const db = getFirebase().db;
  const batch = writeBatch(db);
  batch.update(doc(db, "users", uid), {
    ...fields,
    updatedAt: serverTimestamp(),
  });
  if (teamId)
    batch.update(doc(db, "teams", teamId, "members", uid), {
      displayName: fields.displayName,
      updatedAt: serverTimestamp(),
    });
  return batch.commit();
}

export function savePreferences(
  uid: string,
  preferences: Profile["preferences"],
) {
  return updateDoc(doc(getFirebase().db, "users", uid), {
    preferences,
    updatedAt: serverTimestamp(),
  });
}

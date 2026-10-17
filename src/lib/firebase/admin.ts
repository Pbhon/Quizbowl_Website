import "server-only";
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export function getFirebaseAdmin() {
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Firebase Admin project is not configured.");
  if (
    process.env.FIREBASE_ADMIN_PROJECT_ID &&
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_ADMIN_PROJECT_ID !==
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  )
    throw new Error("Firebase client and server projects must match.");
  const emulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";
  if (
    emulator &&
    (process.env.NODE_ENV === "production" || !projectId.startsWith("demo-"))
  ) {
    throw new Error("Server emulators require a local demo project.");
  }
  if (
    !emulator &&
    (process.env.FIREBASE_AUTH_EMULATOR_HOST ||
      process.env.FIRESTORE_EMULATOR_HOST)
  )
    throw new Error("Emulator hosts require explicit local demo mode.");
  if (
    Boolean(process.env.FIREBASE_ADMIN_CLIENT_EMAIL) !==
    Boolean(process.env.FIREBASE_ADMIN_PRIVATE_KEY)
  )
    throw new Error(
      "Firebase service account credentials must be configured together.",
    );
  if (emulator) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  }
  const name = "quizbowl-server";
  let app = getApps().find((candidate) => candidate.name === name);
  if (!app) {
    const email = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    const key = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
    app = initializeApp(
      {
        projectId,
        credential:
          !emulator && email && key
            ? cert({ projectId, clientEmail: email, privateKey: key })
            : applicationDefault(),
      },
      name,
    );
  }
  return { auth: getAuth(app), db: getFirestore(app) };
}

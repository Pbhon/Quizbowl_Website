import test from "node:test";
import assert from "node:assert/strict";
import { loadBackend } from "./helpers/backend.mjs";
test("admin credentials reject mismatched projects, partial certificates and production emulator bypasses", () => {
  for (const env of [
    {
      FIREBASE_ADMIN_PROJECT_ID: "one",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "two",
    },
    {
      FIREBASE_ADMIN_PROJECT_ID: "one",
      FIREBASE_ADMIN_CLIENT_EMAIL: "server@example.com",
    },
    {
      FIREBASE_ADMIN_PROJECT_ID: "one",
      FIREBASE_AUTH_EMULATOR_HOST: "attacker:9099",
    },
    {
      FIREBASE_ADMIN_PROJECT_ID: "one",
      FIRESTORE_EMULATOR_HOST: "attacker:8080",
    },
    {
      FIREBASE_ADMIN_PROJECT_ID: "live-project",
      NEXT_PUBLIC_USE_FIREBASE_EMULATORS: "true",
    },
    {
      FIREBASE_ADMIN_PROJECT_ID: "demo-quizbowl",
      NEXT_PUBLIC_USE_FIREBASE_EMULATORS: "true",
      NODE_ENV: "production",
    },
  ]) {
    let initialized = false;
    const admin = loadBackend(
      "src/lib/firebase/admin.ts",
      {
        "firebase-admin/app": {
          getApps: () => [],
          initializeApp: () => {
            initialized = true;
          },
        },
        "firebase-admin/auth": {},
        "firebase-admin/firestore": {},
      },
      { process: { env } },
    );
    assert.throws(admin.getFirebaseAdmin);
    assert.equal(initialized, false);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { deploymentIssues } from "../scripts/deployment-config.mjs";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const base = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "public-config",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "school.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "school",
  NEXT_PUBLIC_FIREBASE_APP_ID: "web-app",
  FIREBASE_ADMIN_PROJECT_ID: "school",
  SITE_TEAM_ID: "team",
  NEXT_PUBLIC_TEAM_NAME: "Quiz team",
  ADMIN_SIGNUP_CODE: "test-only-code-with-32-characters",
  FIREBASE_ADMIN_CLIENT_EMAIL: "server@school.iam.gserviceaccount.com",
  FIREBASE_ADMIN_PRIVATE_KEY: privateKey,
};
test("hosting configuration rejects missing credentials, mismatched projects and emulator bypasses", () => {
  assert.deepEqual(deploymentIssues(base), []);
  for (const change of [
    { FIREBASE_ADMIN_PRIVATE_KEY: "" },
    { FIREBASE_ADMIN_PROJECT_ID: "other" },
    { NEXT_PUBLIC_USE_FIREBASE_EMULATORS: "true" },
    { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
    {
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-school",
      FIREBASE_ADMIN_PROJECT_ID: "demo-school",
    },
    { GOOGLE_APPLICATION_CREDENTIALS: "C:/local-only.json" },
    { FIREBASE_ADMIN_PRIVATE_KEY: "not-pem" },
    { ADMIN_SIGNUP_CODE: "short" },
  ])
    assert.ok(deploymentIssues({ ...base, ...change }).length);
});
test("local ADC is explicitly separate from hosting and errors do not disclose private material", () => {
  const local = {
    ...base,
    FIREBASE_ADMIN_CLIENT_EMAIL: "",
    FIREBASE_ADMIN_PRIVATE_KEY: "",
    GOOGLE_APPLICATION_CREDENTIALS: "C:/local-only.json",
  };
  assert.deepEqual(deploymentIssues(local, { local: true }), []);
  const issues = deploymentIssues(local);
  assert.ok(issues.length);
  assert.ok(!JSON.stringify(issues).includes("C:/local-only.json"));
});
test("enabled Gemini requires valid model/key/quotas; disabling it keeps core features deployable", () => {
  assert.deepEqual(
    deploymentIssues({ ...base, GEMINI_GENERATION_ENABLED: "false" }),
    [],
  );
  const enabled = {
    ...base,
    GEMINI_GENERATION_ENABLED: "true",
    GEMINI_API_KEY: "private-test-placeholder",
    GEMINI_MODEL: "gemini-3.5-flash-lite",
  };
  assert.deepEqual(deploymentIssues(enabled), []);
  for (const change of [
    { GEMINI_API_KEY: "" },
    { GEMINI_MODEL: "../bad-model" },
    { GEMINI_STUDENT_DAILY_LIMIT: "0" },
    { GEMINI_DEPLOYMENT_DAILY_LIMIT: "1001" },
  ]) {
    const issues = deploymentIssues({ ...enabled, ...change });
    assert.ok(issues.length);
    assert.ok(!JSON.stringify(issues).includes(enabled.GEMINI_API_KEY));
  }
});

import { createPrivateKey } from "node:crypto";

/** Validate configuration without connecting to a service or echoing secrets. */
export function deploymentIssues(env, { local = false } = {}) {
  const issues = [];
  for (const name of [
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID",
  ])
    if (!env[name]?.trim()) issues.push(`${name} is required.`);
  const project = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (project?.startsWith("demo-"))
    issues.push("A demo Firebase project cannot serve the team deployment.");
  if (
    !env.FIREBASE_ADMIN_PROJECT_ID ||
    env.FIREBASE_ADMIN_PROJECT_ID !== project
  )
    issues.push(
      "FIREBASE_ADMIN_PROJECT_ID must match the public Firebase project.",
    );
  if (
    env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" ||
    env.FIRESTORE_EMULATOR_HOST ||
    env.FIREBASE_AUTH_EMULATOR_HOST
  )
    issues.push("Emulators must be disabled for production.");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(env.SITE_TEAM_ID || ""))
    issues.push("SITE_TEAM_ID is required and must be a valid school ID.");
  if (!env.NEXT_PUBLIC_TEAM_NAME?.trim())
    issues.push("NEXT_PUBLIC_TEAM_NAME is required.");
  if (
    !env.ADMIN_SIGNUP_CODE ||
    env.ADMIN_SIGNUP_CODE.length < 16 ||
    env.ADMIN_SIGNUP_CODE.length > 256
  )
    issues.push("ADMIN_SIGNUP_CODE must contain 16–256 characters.");
  const email = env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const key = env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (Boolean(email) !== Boolean(key))
    issues.push(
      "Firebase service-account email and private key must be configured together.",
    );
  if (email && !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(email))
    issues.push("FIREBASE_ADMIN_CLIENT_EMAIL must be a service-account email.");
  if (key) {
    try {
      createPrivateKey(key.replace(/\\n/g, "\n"));
    } catch {
      issues.push(
        "FIREBASE_ADMIN_PRIVATE_KEY must be a valid PEM private key.",
      );
    }
  }
  if (!local && (!email || !key))
    issues.push(
      "Hosting needs FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY; a local ADC file is not deployed.",
    );
  if (!local && env.GOOGLE_APPLICATION_CREDENTIALS)
    issues.push(
      "Remove the local GOOGLE_APPLICATION_CREDENTIALS file path from hosting configuration.",
    );
  if (env.GEMINI_GENERATION_ENABLED === "true") {
    if (!env.GEMINI_API_KEY?.trim())
      issues.push("Enabled Gemini generation needs GEMINI_API_KEY.");
    if (!/^[a-zA-Z0-9.-]{1,80}$/.test(env.GEMINI_MODEL || ""))
      issues.push("Enabled Gemini generation needs a valid GEMINI_MODEL.");
    for (const [name, max] of [
      ["GEMINI_STUDENT_DAILY_LIMIT", 100],
      ["GEMINI_DEPLOYMENT_DAILY_LIMIT", 1000],
      ["GEMINI_DEPLOYMENT_MINUTE_LIMIT", 60],
    ]) {
      const raw = env[name];
      if (raw && (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max))
        issues.push(`${name} must be an integer from 1 to ${max}.`);
    }
  }
  return issues;
}

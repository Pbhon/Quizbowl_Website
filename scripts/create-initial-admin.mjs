// Run only after authorizing live first-administrator creation.
// The server validates the same private code required by the website form.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
process.loadEnvFile(".env.local");
const [email, origin = "http://127.0.0.1:3101"] = process.argv.slice(2);
const url = new URL(origin);
if (
  !email ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.protocol !== "http:"
)
  throw new Error(
    "Usage: node scripts/create-initial-admin.mjs EMAIL http://127.0.0.1:3101",
  );
if (
  process.env.FIREBASE_ADMIN_PROJECT_ID !== "quizbowl-66145" ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true"
)
  throw new Error(
    "This helper requires the connected live quizbowl-66145 project.",
  );
const password = randomBytes(24).toString("base64url");
mkdirSync(".tools", { recursive: true });
const output = ".tools/admin-access.txt";
const credentials =
  "QuizBowl administrator access (private, excluded from Git)\n\nEmail: " +
  email +
  "\nTemporary password: " +
  password +
  "\n\nSign in, verify your email from the profile page, and change this password in Account settings.\nThe administrator signup code is ADMIN_SIGNUP_CODE in .env.local.\n";
writeFileSync(output, "Account provisioning pending.\n" + credentials, {
  flag: "wx",
  encoding: "utf8",
});
const response = await fetch(url.origin + "/api/auth/admin-register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email,
    name: "Team administrator",
    password,
    code: process.env.ADMIN_SIGNUP_CODE,
  }),
});
if (response.status !== 201) {
  const result = await response.json();
  throw new Error("Administrator was not created: " + result.message);
}
writeFileSync(output, credentials, "utf8");
const signIn = await fetch(
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" +
    encodeURIComponent(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  },
);
if (!signIn.ok)
  throw new Error(
    "Account was created and credentials were saved, but live sign-in verification failed.",
  );
const account = await signIn.json();
const base =
  "https://firestore.googleapis.com/v1/projects/quizbowl-66145/databases/(default)/documents/";
const headers = { Authorization: "Bearer " + account.idToken };
const profile = await fetch(base + "users/" + account.localId, { headers });
const staff = await fetch(base + "staff/" + account.localId, { headers });
if (
  !profile.ok ||
  !staff.ok ||
  (await staff.json()).fields?.role?.stringValue !== "admin"
)
  throw new Error(
    "Account was created and credentials were saved, but deployed profile/role access verification failed.",
  );
const denied = await fetch(
  base +
    "adminSignupLimits/" +
    (process.env.SITE_TEAM_ID || process.env.ADMIN_SIGNUP_TEAM_ID),
  {
    headers,
  },
);
if (denied.status !== 403)
  throw new Error("Server-only quota read unexpectedly allowed.");
console.log(
  "Administrator account created for " +
    email +
    ". Live sign-in, profile/role access, and server-data isolation verified. Private credentials saved to " +
    output +
    ". Email verification is required before staff access.",
);

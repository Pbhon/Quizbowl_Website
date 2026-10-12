// Trusted maintenance tool. This file is never imported by the application.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const cliAuth = require("firebase-tools/lib/auth");
const [project, email, role, teamId, mode] = process.argv.slice(2);
if (
  !project ||
  !email ||
  !["teacher", "admin"].includes(role) ||
  !/^[a-zA-Z0-9_-]{1,80}$/.test(teamId || "")
) {
  throw new Error(
    "Usage: node scripts/provision-staff.mjs PROJECT EMAIL teacher|admin TEAM_ID [--check]",
  );
}
const account = cliAuth.getProjectDefaultAccount(process.cwd());
if (!account?.tokens?.refresh_token)
  throw new Error("Sign in with the Firebase CLI first.");
const tokens = await cliAuth.getAccessToken(account.tokens.refresh_token, [
  "https://www.googleapis.com/auth/cloud-platform",
]);
const headers = {
  Authorization: "Bearer " + tokens.access_token,
  "Content-Type": "application/json",
};
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers });
  if (!response.ok)
    throw new Error(
      "Firebase administration request failed (" + response.status + ").",
    );
  return response.json();
}
const lookup = await api(
  "https://identitytoolkit.googleapis.com/v1/projects/" +
    encodeURIComponent(project) +
    "/accounts:lookup",
  { method: "POST", body: JSON.stringify({ email: [email.toLowerCase()] }) },
);
const user = lookup.users?.[0];
if (!user) {
  console.log(
    "No account exists for " +
      email +
      ". Register through the code-protected administrator form first.",
  );
  process.exit(2);
}
if (mode === "--check") {
  console.log(
    JSON.stringify({
      email: user.email,
      uid: user.localId,
      verified: user.emailVerified === true,
    }),
  );
  process.exit(0);
}
// Require the configured code for administrator provisioning too.
if (role === "admin") {
  process.loadEnvFile(".env.local");
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const expected = process.env.ADMIN_SIGNUP_CODE;
  const supplied = process.env.STAFF_PROVISION_CODE;
  if (
    !expected ||
    !supplied ||
    !timingSafeEqual(
      createHash("sha256").update(expected).digest(),
      createHash("sha256").update(supplied).digest(),
    )
  )
    throw new Error(
      "Set STAFF_PROVISION_CODE to the private administrator code before provisioning.",
    );
}
const base =
  "https://firestore.googleapis.com/v1/projects/" +
  encodeURIComponent(project) +
  "/databases/(default)/documents/staff/" +
  encodeURIComponent(user.localId);
await api(base + "?updateMask.fieldPaths=role&updateMask.fieldPaths=teamId", {
  method: "PATCH",
  body: JSON.stringify({
    fields: { role: { stringValue: role }, teamId: { stringValue: teamId } },
  }),
});
console.log(
  "Assigned " +
    role +
    " access for " +
    email +
    " in team " +
    teamId +
    ". Email verification is " +
    (user.emailVerified ? "complete." : "required before staff access."),
);

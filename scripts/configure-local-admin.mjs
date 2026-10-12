// Reuse the trusted Firebase CLI's existing local credential file.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const require = createRequire(import.meta.url);
const auth = require("firebase-tools/lib/auth");
const credentials = require("firebase-tools/lib/defaultCredentials");
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error("Sign in with the Firebase CLI first.");
const credentialPath = await credentials.getCredentialPathAsync(account);
if (!credentialPath)
  throw new Error("Local Firebase credentials are unavailable.");
let env = readFileSync(".env.local", "utf8");
function set(name, value) {
  const line = name + "=" + value;
  const pattern = new RegExp("^" + name + "=.*$", "m");
  env = pattern.test(env)
    ? env.replace(pattern, () => line)
    : env.trimEnd() + "\n" + line + "\n";
}
if (!/^ADMIN_SIGNUP_CODE=.{16,}$/m.test(env))
  set("ADMIN_SIGNUP_CODE", randomBytes(24).toString("base64url"));
if (!/^SITE_TEAM_ID=.+$/m.test(env)) set("SITE_TEAM_ID", "quizbowl-team");
if (!/^NEXT_PUBLIC_TEAM_NAME=.+$/m.test(env))
  set("NEXT_PUBLIC_TEAM_NAME", "Your high school");
set("FIREBASE_ADMIN_PROJECT_ID", "quizbowl-66145");
set("GOOGLE_APPLICATION_CREDENTIALS", credentialPath.replaceAll("\\", "/"));
writeFileSync(".env.local", env, "utf8");
console.log(
  "Private administrator code and local server credentials are configured. No credentials were printed.",
);

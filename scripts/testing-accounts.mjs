// Trusted local maintenance for explicitly authorized disposable testing accounts.
// Credentials are stored only in the Git-ignored .tools directory.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

process.loadEnvFile(".env.local");
const [mode = "check", origin = "http://127.0.0.1:3000"] =
  process.argv.slice(2);
const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const teamId = process.env.SITE_TEAM_ID || process.env.ADMIN_SIGNUP_TEAM_ID;
if (
  projectId !== "quizbowl-66145" ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" ||
  !/^[a-zA-Z0-9_-]{1,80}$/.test(teamId || "")
)
  throw new Error("Use only the configured live QuizBowl project and school.");
if (!["create", "check", "delete"].includes(mode))
  throw new Error("Use create, check, or delete.");
const url = new URL(origin);
if (
  url.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(url.hostname)
)
  throw new Error("Use a local website URL.");
const app = initializeApp({ projectId, credential: applicationDefault() });
const auth = getAuth(app),
  db = getFirestore(app);
const path = ".tools/testing-accounts.json";
let manifest;
if (existsSync(path)) manifest = JSON.parse(readFileSync(path, "utf8"));
else if (mode === "create") {
  const suffix = randomBytes(6).toString("hex");
  manifest = {
    projectId,
    teamId,
    school: process.env.NEXT_PUBLIC_TEAM_NAME || "Your high school",
    createdAt: new Date().toISOString(),
    status: "pending",
    accounts: ["student", "admin"].map((role) => ({
      role,
      uid: `quizbowl-test-${role}-${suffix}`,
      email: `quizbowl-test-${role}-${suffix}@example.com`,
      password: randomBytes(18).toString("base64url"),
      displayName: `Temporary test ${role}`,
    })),
  };
  mkdirSync(".tools", { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
} else throw new Error("No disposable testing-account manifest exists.");
if (
  manifest.projectId !== projectId ||
  manifest.teamId !== teamId ||
  !Array.isArray(manifest.accounts) ||
  manifest.accounts.length !== 2
)
  throw new Error(
    "The testing manifest does not match the configured project and school.",
  );
for (const account of manifest.accounts) {
  if (
    !["student", "admin"].includes(account.role) ||
    !new RegExp(`^quizbowl-test-${account.role}-[a-f0-9]{12}$`).test(
      account.uid,
    ) ||
    account.email !== `${account.uid}@example.com`
  )
    throw new Error(
      "Only the exact disposable account identities can be managed.",
    );
}
const save = () =>
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
if (mode === "delete") {
  for (const account of manifest.accounts) {
    try {
      const existing = await auth.getUser(account.uid);
      if (existing.email !== account.email)
        throw new Error("Account identity changed; refusing cleanup.");
      await auth.updateUser(account.uid, { disabled: true });
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
    const entries = await db
      .collection(`teams/${teamId}/sharedDecks`)
      .where("ownerUid", "==", account.uid)
      .get();
    await Promise.all(entries.docs.map((doc) => doc.ref.delete()));
    await db.recursiveDelete(db.doc(`users/${account.uid}`));
    await db.doc(`staff/${account.uid}`).delete();
    await db.doc(`teams/${teamId}/members/${account.uid}`).delete();
    await db.doc(`memberships/${account.uid}`).delete();
    try {
      await auth.deleteUser(account.uid);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
    delete account.password;
  }
  manifest.status = "deleted";
  manifest.deletedAt = new Date().toISOString();
  save();
  console.log(
    "Both disposable accounts, their profiles, memberships, decks and sharing pointers were deleted.",
  );
} else {
  if (mode === "create" && manifest.status === "pending") {
    for (const account of manifest.accounts) {
      try {
        await auth.getUser(account.uid);
      } catch (error) {
        if (error.code !== "auth/user-not-found") throw error;
        await auth.createUser({
          uid: account.uid,
          email: account.email,
          password: account.password,
          displayName: account.displayName,
          disabled: true,
          emailVerified: true,
        });
      }
      const existing = await auth.getUser(account.uid);
      if (existing.email !== account.email)
        throw new Error("Account identity changed; refusing provisioning.");
      const batch = db.batch();
      const timestamp = FieldValue.serverTimestamp();
      batch.set(db.doc(`users/${account.uid}`), {
        displayName: account.displayName,
        bio: "Temporary account for manual testing.",
        grade: "",
        preferences: { theme: "system", reducedMotion: false },
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      batch.set(db.doc(`teams/${teamId}/members/${account.uid}`), {
        displayName: account.displayName,
        joinedAt: timestamp,
        updatedAt: timestamp,
      });
      if (account.role === "admin")
        batch.set(db.doc(`staff/${account.uid}`), { role: "admin", teamId });
      await batch.commit();
      await auth.updateUser(account.uid, { disabled: false });
    }
    manifest.status = "active";
    save();
  }
  if (manifest.status !== "active")
    throw new Error("The testing accounts are not active.");
  for (const account of manifest.accounts) {
    const user = await auth.getUser(account.uid);
    const [profile, member, staff] = await Promise.all([
      db.doc(`users/${account.uid}`).get(),
      db.doc(`teams/${teamId}/members/${account.uid}`).get(),
      db.doc(`staff/${account.uid}`).get(),
    ]);
    if (
      user.email !== account.email ||
      user.disabled ||
      !user.emailVerified ||
      !profile.exists ||
      !member.exists ||
      (account.role === "admin"
        ? staff.data()?.role !== "admin" || staff.data()?.teamId !== teamId
        : staff.exists)
    )
      throw new Error(
        `The ${account.role} account is not configured correctly.`,
      );
    const response = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" +
        encodeURIComponent(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: account.email,
          password: account.password,
          returnSecureToken: true,
        }),
      },
    );
    if (!response.ok)
      throw new Error(`The ${account.role} account could not sign in.`);
    const signedIn = await response.json();
    const headers = {
      Authorization: `Bearer ${signedIn.idToken}`,
      "Content-Type": "application/json",
    };
    const team = await fetch(url.origin + "/api/auth/team-session", {
      method: "POST",
      headers,
    });
    if (!team.ok || (await team.json()).teamId !== teamId)
      throw new Error("Website school enrollment failed.");
    const decks = await fetch(url.origin + "/api/decks", { headers });
    if (!decks.ok)
      throw new Error(`The ${account.role} account could not load decks.`);
    console.log(
      `${account.role}: sign-in, profile, role, same-school membership and website deck access verified.`,
    );
  }
  console.log(
    `Private credentials: ${path}. School: ${manifest.school} (${teamId}). No credentials printed.`,
  );
}

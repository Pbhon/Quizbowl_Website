import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

export function retentionCutoff(days, now = Date.now()) {
  if (!Number.isInteger(days) || days < 30 || days > 3650)
    throw Error("Retention must be an explicit integer from 30 to 3650 days.");
  return new Date(now - days * 86400000);
}
function milliseconds(value) {
  if (value?.toMillis) return value.toMillis();
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : Infinity;
}
export function expiredSession(data, cutoff) {
  return (
    Boolean(data) &&
    milliseconds(data.createdAt) < cutoff.getTime() &&
    milliseconds(data.updatedAt || data.createdAt) < cutoff.getTime()
  );
}
export async function purgeSession(db, session, cutoff, apply) {
  const preview = await session.get();
  if (!expiredSession(preview.data(), cutoff)) return false;
  if (!apply) return true;
  // Delete the canonical parent first, in a transaction that detects active work.
  // Attempts already in flight must then fail their session-existence check.
  const closed = await db.runTransaction(async (tx) => {
    if (!expiredSession((await tx.get(session)).data(), cutoff)) return false;
    tx.delete(session);
    return true;
  });
  if (!closed) return false;
  const root = session.parent.parent;
  await removeQuery(
    db,
    root.collection("attempts").where("sessionId", "==", session.id),
    true,
  );
  await removeQuery(
    db,
    root
      .collection("attemptSubmissions")
      .where("input.sessionId", "==", session.id),
    true,
  );
  await db.recursiveDelete(session);
  return true;
}
async function removeQuery(db, query, apply) {
  let count = 0;
  // Requery after deletion; dry runs page instead of repeatedly reading page one.
  let next = query.limit(100);
  while (true) {
    const page = await next.get();
    for (const doc of page.docs) {
      count++;
      if (apply) await db.recursiveDelete(doc.ref);
    }
    if (page.size < 100) break;
    if (!apply) next = query.startAfter(page.docs.at(-1)).limit(100);
  }
  return count;
}
export async function processDeletion(db, auth, job, apply, now = Date.now()) {
  const uid = job.id;
  const data = (await job.get()).data();
  if (!data || !["requested", "deleting"].includes(data.status))
    return "ignored";
  if (!apply)
    return data.status === "requested"
      ? "would-disable"
      : "would-erase-after-grace";
  if (data.status === "requested") {
    try {
      await auth.updateUser(uid, { disabled: true });
      await auth.revokeRefreshTokens(uid);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
    // Existing direct Firestore ID tokens can last one hour. Do not erase until
    // those tokens and all in-flight requests have expired, preventing recreation.
    await job.set({
      status: "deleting",
      requestedAt: data.requestedAt,
      notBefore: new Date(now + 65 * 60000),
    });
    return "disabled-waiting";
  }
  if (milliseconds(data.notBefore) > now) return "waiting";
  // The closure must still be disabled if an operator re-enabled it meanwhile.
  try {
    if (!(await auth.getUser(uid)).disabled)
      throw Error("Account must remain disabled during deletion.");
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }
  for (const team of await db.collection("teams").listDocuments()) {
    await db.recursiveDelete(team.collection("members").doc(uid));
    await removeQuery(
      db,
      team.collection("sharedDecks").where("ownerUid", "==", uid),
      true,
    );
    for (const assignment of await team
      .collection("assignments")
      .listDocuments()) {
      await db.recursiveDelete(assignment.collection("progress").doc(uid));
      const record = (await assignment.get()).data();
      if (record?.studentUids?.includes(uid))
        await assignment.update({ studentUids: FieldValue.arrayRemove(uid) });
      if (record?.createdBy === uid)
        await assignment.update({ createdBy: "deleted-account" });
    }
    for (const event of await team.collection("events").listDocuments()) {
      await db.recursiveDelete(event.collection("rsvps").doc(uid));
      if ((await event.get()).data()?.createdBy === uid)
        await event.update({ createdBy: "deleted-account" });
    }
    for (const announcement of await team
      .collection("announcements")
      .where("createdBy", "==", uid)
      .get()
      .then((page) => page.docs))
      await announcement.ref.update({ createdBy: "deleted-account" });
  }
  // Remove source-owner references in other accounts' shared-study receipts.
  const prefix = `users/${uid}/decks/`;
  for (const user of await db.collection("users").listDocuments())
    await removeQuery(
      db,
      user
        .collection("studyReviews")
        .where("deckPath", ">=", prefix)
        .where("deckPath", "<=", prefix + "\uf8ff"),
      true,
    );
  await db.recursiveDelete(db.doc(`users/${uid}`));
  await db.recursiveDelete(db.doc(`staff/${uid}`));
  await db.recursiveDelete(db.doc(`memberships/${uid}`));
  try {
    await auth.deleteUser(uid);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }
  await job.delete();
  return "erased";
}
export async function maintainData(
  db,
  auth,
  { apply = false, days, deletions = false, now = Date.now() } = {},
) {
  const result = {
    apply,
    expiredEphemeral: 0,
    sessions: 0,
    dailySummaries: 0,
    reviews: 0,
    deletionStates: {},
  };
  for (const collection of ["apiRateLimits", "aiGenerationUsage"])
    result.expiredEphemeral += await removeQuery(
      db,
      db.collection(collection).where("expiresAt", "<", new Date(now)),
      apply,
    );
  const cutoff = days === undefined ? null : retentionCutoff(days, now);
  for (const user of await db.collection("users").listDocuments()) {
    result.expiredEphemeral += await removeQuery(
      db,
      user.collection("aiUsage").where("expiresAt", "<", new Date(now)),
      apply,
    );
    if (!cutoff) continue;
    // listDocuments includes parents left missing by an interrupted prior run.
    for (const session of await user
      .collection("practiceSessions")
      .listDocuments()) {
      const snapshot = await session.get();
      if (!snapshot.exists && apply) {
        await removeQuery(
          db,
          user.collection("attempts").where("sessionId", "==", session.id),
          true,
        );
        await removeQuery(
          db,
          user
            .collection("attemptSubmissions")
            .where("input.sessionId", "==", session.id),
          true,
        );
        await db.recursiveDelete(session);
      } else if (await purgeSession(db, session, cutoff, apply))
        result.sessions++;
    }
    // Recover cleanup after the parent/questions were deleted but receipts remain.
    for (const collection of ["attempts", "attemptSubmissions"]) {
      const old = await user
        .collection(collection)
        .where("createdAt", "<", cutoff)
        .get();
      for (const record of old.docs) {
        const sessionId =
          collection === "attempts"
            ? record.data().sessionId
            : record.data().input?.sessionId;
        if (
          typeof sessionId === "string" &&
          /^[a-zA-Z0-9_-]{1,200}$/.test(sessionId) &&
          !(await user.collection("practiceSessions").doc(sessionId).get())
            .exists &&
          apply
        )
          await db.recursiveDelete(record.ref);
      }
    }
    result.dailySummaries += await removeQuery(
      db,
      user
        .collection("dailyStatistics")
        .where("day", "<", cutoff.toISOString().slice(0, 10)),
      apply,
    );
    result.reviews += await removeQuery(
      db,
      user.collection("studyReviews").where("completedAt", "<", cutoff),
      apply,
    );
  }
  if (deletions)
    for (const job of await db.collection("privacyJobs").listDocuments()) {
      const status = await processDeletion(db, auth, job, apply, now);
      result.deletionStates[status] = (result.deletionStates[status] || 0) + 1;
    }
  return result;
}
async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set([
    "--project",
    "--retention-days",
    "--apply",
    "--deletions",
    "--emulator",
  ]);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw Error("Unknown maintenance option.");
    if (["--project", "--retention-days"].includes(args[i])) i++;
  }
  const project = args[args.indexOf("--project") + 1];
  if (!args.includes("--project") || !/^[a-zA-Z0-9-]+$/.test(project || ""))
    throw Error("Supply the intended --project explicitly.");
  if (
    process.env.FIREBASE_ADMIN_PROJECT_ID &&
    process.env.FIREBASE_ADMIN_PROJECT_ID !== project
  )
    throw Error("Project does not match server configuration.");
  const emulator = args.includes("--emulator");
  if (
    emulator &&
    (!project.startsWith("demo-") || process.env.NODE_ENV === "production")
  )
    throw Error("Emulator maintenance requires a local demo project.");
  if (
    !emulator &&
    (process.env.FIREBASE_AUTH_EMULATOR_HOST ||
      process.env.FIRESTORE_EMULATOR_HOST)
  )
    throw Error("Unexpected emulator hosts.");
  if (emulator) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  }
  const days = args.includes("--retention-days")
    ? Number(args[args.indexOf("--retention-days") + 1])
    : undefined;
  if (days !== undefined) retentionCutoff(days);
  const email = process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    key = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (Boolean(email) !== Boolean(key))
    throw Error("Incomplete service account configuration.");
  const app = initializeApp({
    projectId: project,
    credential:
      !emulator && email && key
        ? cert({
            projectId: project,
            clientEmail: email,
            privateKey: key.replace(/\\n/g, "\n"),
          })
        : applicationDefault(),
  });
  console.log(
    JSON.stringify(
      await maintainData(getFirestore(app), getAuth(app), {
        apply: args.includes("--apply"),
        days,
        deletions: args.includes("--deletions"),
      }),
      null,
      2,
    ),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error(
      "Data maintenance failed. No credentials or personal data are logged; check configuration and retry.",
    );
    process.exitCode = 1;
  });

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { loadBackend } from "./helpers/backend.mjs";
import {
  maintainData,
  processDeletion,
  purgeSession,
  retentionCutoff,
} from "../scripts/data-maintenance.mjs";
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080")
  throw Error(
    "Backend integration tests require the local demo Firestore emulator.",
  );
const app = initializeApp({ projectId: "demo-quizbowl" }, "backend-tests");
const db = getFirestore(app);
const roots = new Set();
after(async () => {
  for (const path of roots) await db.recursiveDelete(db.doc(path));
  await deleteApp(app);
});
function fixture() {
  const uid = `backend-${randomUUID()}`,
    other = `backend-${randomUUID()}`,
    teamId = `backend-${randomUUID()}`;
  for (const path of [
    `users/${uid}`,
    `users/${other}`,
    `teams/${teamId}`,
    `privacyJobs/${uid}`,
  ])
    roots.add(path);
  const server = loadBackend("src/lib/server/account-data.ts", {
    "./site-team": { siteTeam: () => ({ id: teamId }) },
  });
  return { uid, other, teamId, server };
}

test("real Firestore concurrent students reserve one generation lease and reuse its result", async () => {
  const { uid, other } = fixture();
  const model = `test-${randomUUID()}`;
  const question = {
    id: randomUUID(),
    type: "tossup",
    leadin: "",
    parts: ["This molecule has a double helix."],
    answers: ["DNA"],
    answerLines: ["DNA"],
  };
  const clue = {
    clue: "Name the double-helix molecule.",
    part: 0,
    complexity: "simple",
    sourceExcerpt: "double helix",
  };
  for (const owner of [uid, other]) {
    await db.doc(`users/${owner}/decks/deck`).set({ name: "Deck" });
    await db.doc(`users/${owner}/decks/deck/questions/card`).set({ question });
  }
  let calls = 0;
  const server = loadBackend(
    "src/lib/server/ai-generation.ts",
    {},
    {
      process: {
        env: {
          GEMINI_API_KEY: "test-only",
          GEMINI_MODEL: model,
          GEMINI_GENERATION_ENABLED: "true",
        },
      },
      fetch: async () => {
        calls++;
        return Response.json({
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: JSON.stringify([clue]) }] },
            },
          ],
        });
      },
    },
  );
  const { clueCacheKey } = loadBackend("src/lib/server/clue-cache.ts");
  roots.add(`aiClueCache/${clueCacheKey(question, model)}`);
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, index) =>
      server.generateSavedClues(
        db,
        index % 2 ? uid : other,
        "deck",
        "card",
        true,
      ),
    ),
  );
  assert.ok(results.some((result) => result.status === "fulfilled"));
  assert.equal(calls, 1);
  for (const owner of [uid, other])
    assert.equal(
      (await server.generateSavedClues(db, owner, "deck", "card", true)).cached,
      true,
    );
  assert.equal(calls, 1);
  const day = new Date().toISOString().slice(0, 10);
  const quotas = await db.getAll(
    db.doc(`users/${uid}/aiUsage/${day}`),
    db.doc(`users/${other}/aiUsage/${day}`),
  );
  assert.equal(
    quotas.reduce((sum, doc) => sum + (doc.data()?.count || 0), 0),
    1,
  );
});
test("account exports include nested owner records and own school progress but exclude other accounts", async () => {
  const { uid, other, teamId, server } = fixture();
  const owned = [
    `users/${uid}`,
    `users/${uid}/decks/one`,
    `users/${uid}/decks/one/questions/card`,
    `teams/${teamId}/members/${uid}`,
    `teams/${teamId}/assignments/work/progress/${uid}`,
    `teams/${teamId}/assignments/work/progress/${uid}/versions/1/questions/question`,
    `teams/${teamId}/events/event/rsvps/${uid}`,
  ];
  for (const path of owned) await db.doc(path).set({ value: "owned" });
  await db.doc(`users/${other}`).set({ secret: "other-student" });
  await db
    .doc(`teams/${teamId}/assignments/work/progress/${other}`)
    .set({ secret: "other-progress" });
  const data = await server.exportAccountData(db, uid);
  assert.equal(data.records.length, owned.length);
  assert.ok(
    owned.every((path) => data.records.some((record) => record.path === path)),
  );
  assert.ok(!JSON.stringify(data).includes("other-student"));
  assert.ok(!JSON.stringify(data).includes("other-progress"));
});

test("real Firestore contention records one final attempt, receipt and daily summary", async () => {
  const { uid } = fixture();
  const sessionId = randomUUID(),
    session = db.doc(`users/${uid}/practiceSessions/${sessionId}`);
  await session.set({
    createdAt: Timestamp.now(),
    totalParts: 1,
    attemptedParts: 0,
    correct: 0,
    incorrect: 0,
    skipped: 0,
  });
  await session
    .collection("questions")
    .doc("0")
    .set({
      id: "q",
      type: "tossup",
      category: "Science",
      parts: ["Name a molecule."],
      answers: ["DNA"],
      answerLines: ["DNA"],
    });
  const server = loadBackend("src/lib/server/practice-persistence.ts", {
    "@/lib/server/qbreader": {
      qbreader: async () => ({ directive: "accept" }),
    },
  });
  const input = {
    sessionId,
    requestId: randomUUID(),
    questionIndex: 0,
    part: 0,
    givenAnswer: "DNA",
    skipped: false,
    revealedWords: 0,
  };
  const results = await Promise.all(
    Array.from({ length: 5 }, () => server.savePracticeAttempt(db, uid, input)),
  );
  assert.ok(results.every((result) => result.directive === "accept"));
  assert.equal((await session.get()).data().attemptedParts, 1);
  const day = new Date().toISOString().slice(0, 10);
  const summary = (
    await db.doc(`users/${uid}/dailyStatistics/${day}`).get()
  ).data();
  assert.equal(summary.responses, 1);
  assert.equal(summary.questions, 1);
  assert.equal(summary.correct, 1);
  assert.equal(
    (await db.collection(`users/${uid}/attemptSubmissions`).get()).size,
    1,
  );
});
test("retention previews without writes, closes expired canonical sessions and removes their nested data and receipts", async () => {
  const { uid } = fixture();
  const sessionId = randomUUID();
  const session = db.doc(`users/${uid}/practiceSessions/${sessionId}`);
  const old = Timestamp.fromDate(new Date("2024-01-01T00:00:00Z"));
  await session.set({ createdAt: old });
  await session.collection("questions").doc("0").set({ question: "original" });
  const attempt = db.doc(`users/${uid}/attempts/attempt`),
    receipt = db.doc(`users/${uid}/attemptSubmissions/receipt`);
  await attempt.set({ sessionId, createdAt: old });
  await receipt.set({ input: { sessionId }, createdAt: old });
  const cutoff = retentionCutoff(365);
  assert.equal(await purgeSession(db, session, cutoff, false), true);
  assert.equal((await session.get()).exists, true);
  assert.equal(await purgeSession(db, session, cutoff, true), true);
  for (const ref of [
    session,
    session.collection("questions").doc("0"),
    attempt,
    receipt,
  ])
    assert.equal((await ref.get()).exists, false);
  // A previous interrupted cleanup left a receipt and attempt, but no parent.
  await attempt.set({ sessionId, createdAt: old });
  await receipt.set({ input: { sessionId }, createdAt: old });
  await maintainData(db, {}, { apply: true, days: 365 });
  assert.equal((await attempt.get()).exists, false);
  assert.equal((await receipt.get()).exists, false);
});
test("deletion waits for old tokens, removes owned data and school references, and preserves other accounts", async () => {
  const { uid, other, teamId } = fixture();
  const job = db.doc(`privacyJobs/${uid}`);
  await job.set({ status: "requested", requestedAt: Timestamp.now() });
  await db.doc(`users/${uid}`).set({ displayName: "Remove me" });
  await db
    .doc(`users/${uid}/decks/deck/questions/card`)
    .set({ text: "private" });
  await db.doc(`users/${other}`).set({ displayName: "Keep me" });
  await db
    .doc(`users/${other}/studyReviews/review`)
    .set({ deckPath: `users/${uid}/decks/deck` });
  await db
    .doc(`teams/${teamId}/members/${uid}`)
    .set({ displayName: "Remove me" });
  await db
    .doc(`teams/${teamId}/assignments/work`)
    .set({ studentUids: [uid, other], createdBy: uid });
  await db
    .doc(
      `teams/${teamId}/assignments/work/progress/${uid}/versions/1/questions/q`,
    )
    .set({ correct: 1 });
  await db
    .doc(`teams/${teamId}/events/event/rsvps/${uid}`)
    .set({ response: "going" });
  await db.doc(`teams/${teamId}/sharedDecks/share`).set({ ownerUid: uid });
  let disabled = false,
    erased = false;
  const auth = {
    updateUser: async () => {
      disabled = true;
    },
    revokeRefreshTokens: async () => {},
    getUser: async () => ({ disabled }),
    deleteUser: async () => {
      erased = true;
    },
  };
  const now = Date.now();
  assert.equal(
    await processDeletion(db, auth, job, false, now),
    "would-disable",
  );
  assert.equal(disabled, false);
  assert.equal(
    await processDeletion(db, auth, job, true, now),
    "disabled-waiting",
  );
  assert.equal(
    await processDeletion(db, auth, job, true, now + 64 * 60000),
    "waiting",
  );
  assert.equal(erased, false);
  assert.equal(
    await processDeletion(db, auth, job, true, now + 66 * 60000),
    "erased",
  );
  assert.equal(erased, true);
  assert.equal((await db.doc(`users/${uid}`).get()).exists, false);
  assert.equal(
    (await db.doc(`users/${uid}/decks/deck/questions/card`).get()).exists,
    false,
  );
  assert.equal(
    (await db.doc(`users/${other}/studyReviews/review`).get()).exists,
    false,
  );
  assert.equal(
    (await db.doc(`users/${other}`).get()).data().displayName,
    "Keep me",
  );
  assert.equal(
    (
      await db
        .doc(
          `teams/${teamId}/assignments/work/progress/${uid}/versions/1/questions/q`,
        )
        .get()
    ).exists,
    false,
  );
  assert.deepEqual(
    (await db.doc(`teams/${teamId}/assignments/work`).get()).data().studentUids,
    [other],
  );
  assert.equal((await job.get()).exists, false);
});

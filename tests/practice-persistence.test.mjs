import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import ts from "typescript";
function support(path, imports) {
  const mod = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module: mod,
      exports: mod.exports,
      require: (id) => {
        if (id in imports) return imports[id];
        throw Error(id);
      },
      URLSearchParams,
    },
  );
  return mod.exports;
}
function load(
  verifyIdToken = async () => ({ uid: "student-one" }),
  checker = async () => ({ directive: "accept", directedPrompt: null }),
) {
  const compiledModule = { exports: {} };
  let assignmentSupport;
  const code = ts.transpileModule(
    readFileSync("src/lib/server/practice-persistence.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    module: compiledModule,
    exports: compiledModule.exports,
    require: (id) => {
      if (id === "./assignment-progress")
        return (assignmentSupport = support(
          "src/lib/server/assignment-progress.ts",
          {
            "server-only": {},
            "node:crypto": { createHash, randomUUID },
            "firebase-admin/firestore": {
              FieldValue: { serverTimestamp: () => "server-time" },
            },
            "@/lib/assignment-requirements": support(
              "src/lib/assignment-requirements.ts",
              {},
            ),
            "./site-team": { siteTeam: () => ({ id: "school" }) },
            "./practice-persistence": compiledModule.exports,
          },
        ));
      if (id === "server-only") return {};
      if (id === "./daily-statistics")
        return support("src/lib/server/daily-statistics.ts", {
          "server-only": {},
          "firebase-admin/firestore": {
            FieldValue: {
              serverTimestamp: () => "server-time",
              increment: (increment) => ({ increment }),
            },
          },
        });
      if (id === "node:crypto") return { randomUUID };
      if (id === "firebase-admin/firestore")
        return {
          FieldValue: {
            serverTimestamp: () => "server-time",
            increment: (increment) => ({ increment }),
          },
        };
      if (id === "@/lib/firebase/admin")
        return {
          getFirebaseAdmin: () => ({ db: {}, auth: { verifyIdToken } }),
        };
      if (id === "@/lib/server/qbreader") return { qbreader: checker };
      throw new Error(`Unexpected import ${id}`);
    },
    URL,
    URLSearchParams,
  });
  return { ...compiledModule.exports, assignmentSupport };
}
function request(headers = {}) {
  return new Request("http://localhost:3103/api/practice/attempts", {
    headers: { host: "127.0.0.1:3103", ...headers },
  });
}
test("guest practice is optional but saving requires a valid non-revoked token", async () => {
  const { authenticatePractice } = load(async (token, checkRevoked) => {
    assert.equal(token, "valid-token");
    assert.equal(checkRevoked, true);
    return { uid: "student-one" };
  });
  assert.equal(await authenticatePractice(request(), false), null);
  await assert.rejects(
    () => authenticatePractice(request()),
    (e) => e.status === 401,
  );
  assert.equal(
    (
      await authenticatePractice(
        request({ authorization: "Bearer valid-token" }),
      )
    ).uid,
    "student-one",
  );
  const expired = load(async () => {
    throw new Error("Revoked token");
  });
  await assert.rejects(
    () =>
      expired.authenticatePractice(
        request({ authorization: "Bearer invalid-token" }),
      ),
    (e) => e.status === 401,
  );
});
test("same-origin validation uses the browser host rather than Next's internal request URL", async () => {
  const { authenticatePractice } = load();
  assert.equal(
    (
      await authenticatePractice(
        request({
          authorization: "Bearer token",
          origin: "http://127.0.0.1:3103",
        }),
      )
    ).uid,
    "student-one",
  );
  for (const origin of [
    "https://attacker.example",
    "null",
    "file://127.0.0.1:3103",
  ])
    await assert.rejects(
      () =>
        authenticatePractice(
          request({ authorization: "Bearer token", origin }),
        ),
      (e) => e.status === 403,
    );
});
test("attempt inputs reject path traversal, invalid part positions and malformed submissions", () => {
  const { parseAttempt } = load();
  const valid = {
    sessionId: randomUUID(),
    requestId: randomUUID(),
    questionIndex: 0,
    part: 0,
    givenAnswer: "DNA",
    skipped: false,
    revealedWords: 0,
  };
  assert.equal(parseAttempt(valid).sessionId, valid.sessionId);
  for (const changes of [
    { sessionId: "../../someone" },
    { requestId: "not-an-id" },
    { questionIndex: 50 },
    { part: -1 },
    { givenAnswer: "" },
    { givenAnswer: "x".repeat(501) },
    { skipped: true },
    { revealedWords: -1 },
  ])
    assert.throws(
      () => parseAttempt({ ...valid, ...changes }),
      (e) => e.status === 400,
    );
  assert.throws(
    () => parseAttempt(null),
    (e) => e.status === 400,
  );
});

// Stage writes until commit and serialize competing transactions. Optionally
// rerun a callback with discarded writes, as Firestore does on contention.
function memoryFirestore(initial, retryCallback = false) {
  const records = new Map(Object.entries(initial));
  let queue = Promise.resolve();
  const ref = (path) => ({
    path,
    id: path.split("/").at(-1),
    collection: (name) => collection(`${path}/${name}`),
  });
  const collection = (path) => ({
    doc: (id) => ref(`${path}/${id}`),
    where: (field, _operator, value) => ({ query: true, path, field, value }),
  });
  const snapshot = (ref) =>
    ref.query
      ? {
          docs: [...records]
            .filter(
              ([path, data]) =>
                path.startsWith(`${ref.path}/`) &&
                !path.slice(ref.path.length + 1).includes("/") &&
                data[ref.field] === ref.value,
            )
            .map(([path, data]) => ({
              id: path.split("/").at(-1),
              data: () => structuredClone(data),
            })),
        }
      : {
          exists: records.has(ref.path),
          data: () => structuredClone(records.get(ref.path)),
        };
  const getAll = async (...refs) => refs.map(snapshot);
  return {
    records,
    doc: ref,
    getAll,
    runTransaction: (callback) => {
      const run = queue.then(async () => {
        function transaction() {
          const writes = [];
          return {
            get: async (ref) => {
              assert.equal(writes.length, 0, "read before transaction writes");
              return snapshot(ref);
            },
            getAll: async (...refs) => {
              assert.equal(writes.length, 0, "read before transaction writes");
              return getAll(...refs);
            },
            create: (ref, data) => writes.push({ kind: "create", ref, data }),
            set: (ref, data, options) =>
              writes.push({
                kind: options?.merge ? "update" : "set",
                ref,
                data,
              }),
            update: (ref, data) => writes.push({ kind: "update", ref, data }),
            commit: () => {
              for (const { kind, ref, data } of writes) {
                if (kind === "create")
                  assert.ok(!records.has(ref.path), "receipt must be new");
                const next =
                  kind === "update" ? { ...records.get(ref.path) } : {};
                for (const [key, value] of Object.entries(data))
                  next[key] =
                    value && typeof value === "object" && "increment" in value
                      ? (next[key] || 0) + value.increment
                      : value;
                records.set(ref.path, structuredClone(next));
              }
            },
          };
        }
        if (retryCallback) await callback(transaction());
        const tx = transaction();
        const result = await callback(tx);
        tx.commit();
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}
function persistenceFixture(checker, retryCallback = false) {
  const server = load(undefined, checker);
  const sessionId = randomUUID();
  const sessionPath = `users/student-one/practiceSessions/${sessionId}`;
  const question = {
    id: "same-question",
    type: "bonus",
    category: "History",
    subcategory: "World History",
    difficulty: 4,
    source: "packet",
    leadin: "bonus",
    parts: ["Name an explorer", "Name another explorer"],
    answers: ["John Smith [prompt on Smith]", "John Smith"],
    answerLines: ["John Smith [prompt on Smith]", "John Smith"],
  };
  const db = memoryFirestore(
    {
      [sessionPath]: {
        attemptedParts: 0,
        correct: 0,
        incorrect: 0,
        skipped: 0,
        totalParts: 2,
      },
      [`${sessionPath}/questions/0`]: question,
    },
    retryCallback,
  );
  const input = {
    sessionId,
    questionIndex: 0,
    part: 0,
    requestId: randomUUID(),
    givenAnswer: "John Smith",
    skipped: false,
    revealedWords: 0,
  };
  const attemptPath = `users/student-one/attempts/${sessionId}_0_0`;
  const save = (changes = {}) =>
    server.savePracticeAttempt(
      db,
      "student-one",
      server.parseAttempt({ ...input, ...changes }),
    );
  return { ...server, db, input, sessionPath, attemptPath, save };
}
test("simultaneous identical answers and transaction callback retries save one history row and one score", async () => {
  let calls = 0;
  const fixture = persistenceFixture(async () => {
    calls++;
    return { directive: "accept" };
  }, true);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => fixture.save()),
  );
  assert.ok(results.every((result) => result.directive === "accept"));
  assert.equal(
    fixture.db.records.get(fixture.attemptPath).submissions.length,
    1,
  );
  assert.equal(fixture.db.records.get(fixture.sessionPath).attemptedParts, 1);
  assert.equal(fixture.db.records.get(fixture.sessionPath).correct, 1);
  assert.equal(
    [...fixture.db.records.keys()].filter((p) =>
      p.includes("/attemptSubmissions/"),
    ).length,
    1,
  );
  const previousCalls = calls;
  assert.equal((await fixture.save()).attemptId, results[0].attemptId);
  assert.equal(
    calls,
    previousCalls,
    "acknowledgement retries use the saved verdict",
  );
  for (const changes of [
    { part: 1 },
    { sessionId: randomUUID() },
    { givenAnswer: "banana" },
    { revealedWords: 1 },
    { skipped: true, givenAnswer: "" },
  ])
    await assert.rejects(() => fixture.save(changes), { status: 409 });
  assert.equal(calls, previousCalls, "conflicts never recheck answers");
});
test("different request IDs cannot complete one part twice, but separate parts and deliberate sessions still count", async () => {
  const fixture = persistenceFixture();
  const results = await Promise.allSettled([
    fixture.save(),
    fixture.save({ requestId: randomUUID() }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
  await fixture.save({ requestId: randomUUID(), part: 1 });
  assert.equal(fixture.db.records.get(fixture.sessionPath).attemptedParts, 2);
  assert.equal(fixture.db.records.get(fixture.sessionPath).correct, 2);
  const newSessionId = randomUUID();
  const newSessionPath = `users/student-one/practiceSessions/${newSessionId}`;
  fixture.db.records.set(newSessionPath, {
    attemptedParts: 0,
    correct: 0,
    incorrect: 0,
    skipped: 0,
    totalParts: 2,
  });
  fixture.db.records.set(
    `${newSessionPath}/questions/0`,
    fixture.db.records.get(`${fixture.sessionPath}/questions/0`),
  );
  await fixture.save({ requestId: randomUUID(), sessionId: newSessionId });
  assert.equal(
    [...fixture.db.records.keys()].filter((p) => p.includes("/attempts/"))
      .length,
    3,
  );
});
test("prompt retries return the original prompt after clarification without adding submissions or scores", async () => {
  const fixture = persistenceFixture(async (_endpoint, params) => ({
    directive: params.get("givenAnswer") === "Smith" ? "prompt" : "accept",
    directedPrompt: "Give a first name",
  }));
  await fixture.save({ givenAnswer: "Smith" });
  const promptId = fixture.input.requestId;
  await fixture.save({ requestId: randomUUID(), givenAnswer: "John Smith" });
  const completed = structuredClone(
    fixture.db.records.get(fixture.attemptPath),
  );
  const replayed = await fixture.save({
    requestId: promptId,
    givenAnswer: "Smith",
  });
  assert.equal(replayed.directive, "prompt");
  assert.deepEqual(fixture.db.records.get(fixture.attemptPath), completed);
  assert.equal(completed.submissions.length, 2);
  assert.equal(fixture.db.records.get(fixture.sessionPath).attemptedParts, 1);
});
test("UUID casing and whitespace normalize; legacy attempts gain a receipt without being counted again", async () => {
  const fixture = persistenceFixture(async () => {
    throw Error("Legacy replay must not contact QBReader");
  });
  const oldSubmission = {
    requestId: fixture.input.requestId.toUpperCase(),
    answer: "John Smith",
    directive: "accept",
    directedPrompt: null,
    revealedWords: 0,
    submittedAt: "2026-10-10T12:00:00Z",
  };
  fixture.db.records.set(fixture.attemptPath, {
    outcome: "correct",
    submissions: [oldSubmission],
    createdAt: "original-time",
  });
  fixture.db.records.get(fixture.sessionPath).attemptedParts = 1;
  fixture.db.records.get(fixture.sessionPath).correct = 1;
  assert.equal(
    (
      await fixture.save({
        requestId: fixture.input.requestId.toUpperCase(),
        sessionId: fixture.input.sessionId.toUpperCase(),
        givenAnswer: " John Smith ",
      })
    ).directive,
    "accept",
  );
  assert.equal(
    fixture.db.records.get(fixture.attemptPath).createdAt,
    "original-time",
  );
  assert.equal(fixture.db.records.get(fixture.sessionPath).correct, 1);
  assert.equal(
    [...fixture.db.records.keys()].filter((p) =>
      p.includes("/attemptSubmissions/"),
    ).length,
    1,
  );
  await assert.rejects(() => fixture.save({ part: 1 }), { status: 409 });
});
test("daily summaries commit once with final outcomes and count bonus parts as one question", async () => {
  const fixture = persistenceFixture(undefined, true);
  await Promise.all(Array.from({ length: 4 }, () => fixture.save()));
  await fixture.save({
    part: 1,
    requestId: randomUUID(),
    skipped: true,
    givenAnswer: "",
  });
  const summaries = [...fixture.db.records].filter(([key]) =>
    /\/dailyStatistics\/[^/]+$/.test(key),
  );
  assert.equal(summaries.length, 1);
  const summary = summaries[0][1];
  assert.equal(summary.responses, 2);
  assert.equal(summary.questions, 1);
  assert.equal(summary.correct, 1);
  assert.equal(summary.skipped, 1);
  const prompt = persistenceFixture(async () => ({ directive: "prompt" }));
  await prompt.save();
  assert.equal(
    [...prompt.db.records.keys()].some((key) =>
      key.includes("/dailyStatistics/"),
    ),
    false,
  );
});
function assignmentFixture(checker, retry = true) {
  const fixture = persistenceFixture(checker, retry);
  const assignmentPath = "teams/school/assignments/work";
  const progressPath = `${assignmentPath}/progress/student-one`;
  fixture.db.records.set(assignmentPath, {
    published: true,
    audience: "team",
    questionCount: 1,
    type: "bonus",
    difficultyMin: 3,
    difficultyMax: 5,
    category: "History",
    subcategory: "World History",
    topic: "explorer",
    requirementsVersion: 1,
  });
  fixture.db.records.set("teams/school/members/student-one", {});
  fixture.db.records.get(fixture.sessionPath).assignment = {
    id: "work",
    teamId: "school",
    requirementsVersion: 1,
  };
  return { ...fixture, assignmentPath, progressPath };
}
test("assignment bonuses count once after all parts, across sessions, concurrent retries and callbacks", async () => {
  const fixture = assignmentFixture(async () => ({ directive: "accept" }));
  await Promise.all(Array.from({ length: 4 }, () => fixture.save()));
  assert.equal(
    fixture.db.records.get(fixture.progressPath).completedQuestions,
    0,
  );
  assert.equal(fixture.db.records.get(fixture.progressPath).correct, 1);
  const otherId = randomUUID(),
    otherPath = `users/student-one/practiceSessions/${otherId}`;
  fixture.db.records.set(otherPath, {
    ...fixture.db.records.get(fixture.sessionPath),
    attemptedParts: 0,
    correct: 0,
  });
  fixture.db.records.set(
    `${otherPath}/questions/0`,
    fixture.db.records.get(`${fixture.sessionPath}/questions/0`),
  );
  await fixture.save({ sessionId: otherId, requestId: randomUUID() });
  assert.equal(fixture.db.records.get(fixture.progressPath).correct, 1);
  await Promise.all([
    fixture.save({
      part: 1,
      requestId: randomUUID(),
      skipped: true,
      givenAnswer: "",
    }),
    fixture.save({ sessionId: otherId, part: 1, requestId: randomUUID() }),
  ]);
  const progress = fixture.db.records.get(fixture.progressPath);
  assert.equal(progress.completedQuestions, 1);
  assert.equal(progress.correct, 1);
  assert.equal(progress.skipped, 1);
  assert.equal(
    [...fixture.db.records.keys()].filter((path) =>
      path.startsWith(`${fixture.progressPath}/versions/`),
    ).length,
    1,
  );
});
test("assignment prompts, ordinary practice and revoked audiences do not earn progress", async () => {
  const prompt = assignmentFixture(async () => ({
    directive: "prompt",
    directedPrompt: "More specific",
  }));
  await prompt.save();
  assert.equal(prompt.db.records.has(prompt.progressPath), false);
  for (const change of [
    "membership",
    "draft",
    "audience",
    "staff",
    "version",
    "school",
  ]) {
    const fixture = assignmentFixture(async () => ({ directive: "accept" }));
    if (change === "membership")
      fixture.db.records.delete("teams/school/members/student-one");
    if (change === "draft")
      fixture.db.records.get(fixture.assignmentPath).published = false;
    if (change === "audience")
      Object.assign(fixture.db.records.get(fixture.assignmentPath), {
        audience: "students",
        studentUids: ["someone-else"],
      });
    if (change === "staff")
      fixture.db.records.set("staff/student-one", {
        role: "teacher",
        teamId: "school",
      });
    if (change === "version")
      fixture.db.records.get(fixture.assignmentPath).requirementsVersion = 2;
    if (change === "school")
      fixture.db.records.get(fixture.sessionPath).assignment.teamId = "other";
    await assert.rejects(fixture.save(), (error) =>
      [403, 409].includes(error.status),
    );
    assert.equal(fixture.db.records.has(fixture.progressPath), false);
    assert.equal(fixture.db.records.has(fixture.attemptPath), false);
  }
  const ordinary = assignmentFixture(async () => ({ directive: "accept" }));
  delete ordinary.db.records.get(ordinary.sessionPath).assignment;
  await ordinary.save();
  assert.equal(ordinary.db.records.has(ordinary.progressPath), false);
});
test("assignment credit enforces requirements and resets obsolete progress versions", async () => {
  const mismatch = assignmentFixture(async () => ({ directive: "accept" }));
  mismatch.db.records.get(`${mismatch.sessionPath}/questions/0`).difficulty =
    10;
  await assert.rejects(mismatch.save(), (error) => error.status === 409);
  assert.equal(mismatch.db.records.has(mismatch.progressPath), false);
  const fixture = assignmentFixture(async () => ({ directive: "accept" }));
  fixture.db.records.set(fixture.progressPath, {
    requirementsVersion: 0,
    completedQuestions: 99,
    correct: 99,
  });
  fixture.db.records.get(fixture.assignmentPath).requirementsVersion = 2;
  fixture.db.records.get(fixture.sessionPath).assignment.requirementsVersion =
    2;
  await fixture.save();
  assert.equal(fixture.db.records.get(fixture.progressPath).correct, 1);
  assert.equal(
    fixture.db.records.get(fixture.progressPath).completedQuestions,
    0,
  );
  assert.equal(
    fixture.db.records.get(fixture.progressPath).requirementsVersion,
    2,
  );
});
test("assignment sessions enforce live requirements, completed exclusions and server bindings", async () => {
  const fixture = assignmentFixture(async () => ({ directive: "accept" }));
  const source = await fixture.assignmentSupport.assignmentPracticeSource(
    fixture.db,
    "student-one",
    "work",
  );
  assert.equal(source.count, 1);
  const question = fixture.db.records.get(`${fixture.sessionPath}/questions/0`);
  const created = await fixture.assignmentSupport.createAssignmentSession(
    fixture.db,
    "student-one",
    source.binding,
    [question, question, { ...question, id: "bad", difficulty: 10 }],
  );
  assert.equal(created.questions.length, 1);
  const createdPath = `users/student-one/practiceSessions/${created.sessionId}`;
  assert.equal(
    fixture.db.records.get(createdPath).assignment.requirementsVersion,
    1,
  );
  await fixture.save();
  await fixture.save({
    part: 1,
    requestId: randomUUID(),
    skipped: true,
    givenAnswer: "",
  });
  await assert.rejects(
    fixture.assignmentSupport.assignmentPracticeSource(
      fixture.db,
      "student-one",
      "work",
    ),
    (e) => e.status === 409,
  );
  await assert.rejects(
    fixture.assignmentSupport.createAssignmentSession(
      fixture.db,
      "student-one",
      source.binding,
      [question],
    ),
    (e) => e.status === 409,
  );
  fixture.db.records.get(fixture.assignmentPath).questionCount = 2;
  const remaining = await fixture.assignmentSupport.assignmentPracticeSource(
    fixture.db,
    "student-one",
    "work",
  );
  assert.equal(remaining.count, 1);
  assert.equal(remaining.excluded[0], question.id);
  fixture.db.records.get(fixture.assignmentPath).requirementsVersion = 2;
  await assert.rejects(
    fixture.assignmentSupport.createAssignmentSession(
      fixture.db,
      "student-one",
      source.binding,
      [question],
    ),
    (e) => e.status === 409,
  );
});

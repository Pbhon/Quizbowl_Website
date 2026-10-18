import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
function load(path, imports) {
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
      Date,
      Set,
    },
  );
  return mod.exports;
}
class PracticeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
const roster = [
  { uid: "student", displayName: "Student", role: "student" },
  { uid: "teacher", role: "teacher" },
];
const statistics = load("src/lib/statistics.ts", {});
const requirements = load("src/lib/assignment-requirements.ts", {});
const team = load("src/lib/team-dashboard.ts", {
  "./statistics": statistics,
  "./assignment-requirements": requirements,
});
const helpers = load("src/lib/assignments.ts", {
  "./team-dashboard": team,
  "./assignment-requirements": requirements,
});
const imports = {
  "@/lib/assignment-requirements": requirements,
  "@/lib/assignments": helpers,
  "./site-team": { siteTeam: () => ({ id: "school" }) },
  "@/lib/practice": load("src/lib/practice.ts", {}),
  "server-only": {},
  "firebase-admin/firestore": {
    FieldValue: { serverTimestamp: () => "stamp" },
  },
  "./team-dashboard": {
    requireTeamStaff: async (_db, uid, verified) => {
      if (uid !== "teacher" || !verified)
        throw new PracticeError("Forbidden", 403);
      return "school";
    },
    loadTeamRoster: async () => roster,
  },
  "./practice-persistence": { PracticeError },
  "./history": {
    documentId: (value) => {
      if (typeof value !== "string" || !/^[\w-]+$/.test(value))
        throw new PracticeError("Bad id", 400);
      return value;
    },
  },
  "./dashboard": { timestampISO: (value) => value || null },
  "./decks": {
    deckText: (value, max, required) => {
      if (
        typeof value !== "string" ||
        value.trim().length > max ||
        (required && !value.trim())
      )
        throw new PracticeError("Bad text", 400);
      return value.trim();
    },
  },
};
const server = load("src/lib/server/assignments.ts", imports);
function database(staff = { role: "teacher", teamId: "school" }) {
  const writes = [];
  const db = {
    doc: (path) => ({ path, id: path.split("/").at(-1) }),
    collection: (path) => ({ doc: () => ({ path: `${path}/new`, id: "new" }) }),
    runTransaction: async (work) =>
      work({
        get: async (ref) => ({
          exists: [
            "teams/school/members/student",
            "teams/school/members/student2",
            "teams/school/members/teacher",
          ].includes(ref.path),
          data: () => (ref.path === "staff/teacher" ? staff : undefined),
        }),
        create: (ref, data) => writes.push({ ref, data }),
        update: (ref, data) => writes.push({ ref, data }),
      }),
  };
  return { db, writes };
}
const base = {
  action: "create",
  title: " Practice ",
  description: "Instructions",
  published: true,
};
test("individual assignment targets only current students", async () => {
  const { db, writes } = database();
  await server.saveAssignment(db, "teacher", true, {
    ...base,
    audience: "students",
    studentUids: ["student"],
  });
  assert.equal(writes[0].data.studentUids[0], "student");
  for (const studentUids of [[], ["outsider"], ["teacher"], ["bad/path"]])
    await assert.rejects(
      server.saveAssignment(db, "teacher", true, {
        ...base,
        audience: "students",
        studentUids,
      }),
      (e) => e.status === 400,
    );
});
test("creates school-scoped assignments and rejects unverified/nonstaff writers", async () => {
  const { db, writes } = database();
  assert.equal(
    (await server.saveAssignment(db, "teacher", true, base)).assignmentId,
    "new",
  );
  assert.equal(writes[0].ref.path, "teams/school/assignments/new");
  assert.equal(writes[0].data.title, "Practice");
  assert.equal(writes[0].data.createdBy, "teacher");
  await assert.rejects(
    server.saveAssignment(db, "student", true, base),
    (e) => e.status === 403,
  );
  await assert.rejects(
    server.saveAssignment(db, "teacher", false, base),
    (e) => e.status === 403,
  );
  await assert.rejects(
    server.saveAssignment(
      database({ role: "teacher", teamId: "other" }).db,
      "teacher",
      true,
      base,
    ),
    (e) => e.status === 403,
  );
});
test("validates assignment text, publication, actions and update existence", async () => {
  for (const changed of [
    { title: " " },
    { title: "a".repeat(121) },
    { published: "yes" },
    { action: "delete" },
  ]) {
    const { db, writes } = database();
    await assert.rejects(
      server.saveAssignment(db, "teacher", true, { ...base, ...changed }),
      (e) => e.status === 400,
    );
    assert.equal(writes.length, 0);
  }
  await assert.rejects(
    server.saveAssignment(database().db, "teacher", true, {
      ...base,
      action: "update",
      id: "missing",
    }),
    (e) => e.status === 404,
  );
});
test("group targeting deduplicates students and team audience clears explicit targets", async () => {
  const { db, writes } = database();
  await server.saveAssignment(db, "teacher", true, {
    ...base,
    audience: "students",
    studentUids: ["student", "student2", "student"],
  });
  assert.equal(writes[0].data.studentUids.length, 2);
  await server.saveAssignment(db, "teacher", true, {
    ...base,
    audience: "team",
    studentUids: ["student"],
  });
  assert.equal(writes[1].data.studentUids.length, 0);
});
test("question counts and difficulty ranges enforce integer boundaries", async () => {
  for (const changed of [
    { questionCount: 0 },
    { questionCount: 501 },
    { questionCount: 1.5 },
    { difficultyMin: -1 },
    { difficultyMax: 11 },
    { difficultyMin: 5, difficultyMax: 2 },
    { type: "invalid" },
  ])
    await assert.rejects(
      server.saveAssignment(database().db, "teacher", true, {
        ...base,
        ...changed,
      }),
      (e) => e.status === 400,
    );
  const { db, writes } = database();
  await server.saveAssignment(db, "teacher", true, {
    ...base,
    questionCount: 500,
    difficultyMin: 0,
    difficultyMax: 10,
    type: "bonus",
  });
  assert.equal(writes[0].data.questionCount, 500);
  assert.equal(writes[0].data.type, "bonus");
});
test("subject and topic requirements validate matching taxonomy", async () => {
  for (const changed of [
    { category: "fake" },
    { category: "History", subcategory: "Biology" },
    { topic: "a".repeat(201) },
  ])
    await assert.rejects(
      server.saveAssignment(database().db, "teacher", true, {
        ...base,
        ...changed,
      }),
      (e) => e.status === 400,
    );
  const { db, writes } = database();
  await server.saveAssignment(db, "teacher", true, {
    ...base,
    category: "Science",
    subcategory: "Biology",
    topic: " photosynthesis ",
  });
  assert.equal(writes[0].data.topic, "photosynthesis");
});
test("deadlines normalize UTC instants and can be cleared", async () => {
  for (const dueAt of [
    "garbage",
    "2026-10-12T10:30",
    "2026-13-12T10:30:00Z",
    "2026-02-30T10:30:00Z",
    123,
  ])
    await assert.rejects(
      server.saveAssignment(database().db, "teacher", true, { ...base, dueAt }),
      (e) => e.status === 400,
    );
  const { db, writes } = database();
  await server.saveAssignment(db, "teacher", true, {
    ...base,
    dueAt: "2026-10-20T23:30:00Z",
  });
  assert.equal(writes[0].data.dueAt, "2026-10-20T23:30:00.000Z");
  await server.saveAssignment(db, "teacher", true, { ...base, dueAt: null });
  assert.equal(writes[1].data.dueAt, null);
});
test("completion clamps saved counts and leaves missing performance unknown", () => {
  const assignment = { ...base, audience: "team", questionCount: 10 };
  const empty = helpers.assignmentResult(
    "a",
    assignment,
    undefined,
    "student",
    "Student",
  );
  assert.equal(empty.status, "not started");
  assert.equal(empty.accuracy, null);
  const result = helpers.assignmentResult(
    "a",
    assignment,
    { completedQuestions: 20, correct: 8, incorrect: 2, skipped: 1 },
    "student",
    "Student",
  );
  assert.equal(result.completedQuestions, 10);
  assert.equal(result.accuracy, 80);
  assert.equal(result.status, "completed");
  assert.equal(
    helpers.assignmentResult(
      "a",
      { ...assignment, published: false },
      undefined,
      "student",
      "Student",
    ),
    null,
  );
});
test("student workspace excludes drafts and other students' work and progress", async () => {
  const records = new Map([
    ["teams/school/members/student", {}],
    ["teams/school/members/student2", {}],
    [
      "teams/school/assignments/team",
      { ...base, audience: "team", questionCount: 10 },
    ],
    [
      "teams/school/assignments/own",
      {
        ...base,
        audience: "students",
        studentUids: ["student"],
        questionCount: 10,
      },
    ],
    [
      "teams/school/assignments/other",
      {
        ...base,
        audience: "students",
        studentUids: ["student2"],
        questionCount: 10,
      },
    ],
    [
      "teams/school/assignments/draft",
      { ...base, audience: "team", published: false },
    ],
    [
      "teams/school/assignments/own/progress/student",
      { completedQuestions: 3, correct: 2, incorrect: 1, skipped: 0 },
    ],
    [
      "teams/school/assignments/own/progress/student2",
      { completedQuestions: 99 },
    ],
  ]);
  const db = {
    doc: (path) => ({
      id: path.split("/").at(-1),
      collection: (name) => db.collection(`${path}/${name}`),
      get: async () => ({
        exists: records.has(path),
        data: () => records.get(path),
      }),
    }),
    collection: (path) => ({
      doc: (id) => db.doc(`${path}/${id}`),
      get: async () => ({
        docs: [...records]
          .filter(
            ([key]) =>
              key.startsWith(`${path}/`) &&
              !key.slice(path.length + 1).includes("/"),
          )
          .map(([key, data]) => ({
            id: key.split("/").at(-1),
            data: () => data,
            ref: db.doc(key),
          })),
      }),
    }),
  };
  const data = await server.assignmentWorkspace(db, "student", true);
  assert.equal(data.isStaff, false);
  assert.equal(data.students.length, 0);
  assert.deepEqual(Array.from(data.assignments, (a) => a.id).sort(), [
    "own",
    "team",
  ]);
  assert.equal(
    data.assignments.find((a) => a.id === "own").results[0].completedQuestions,
    3,
  );
  assert.equal(
    data.assignments.every((a) =>
      a.results.every((row) => row.uid === "student"),
    ),
    true,
  );
});
const deckServer = load("src/lib/server/decks.ts", {
  "@/lib/clues": load("src/lib/clues.ts", {}),
  "./deck-permissions": load("src/lib/server/deck-permissions.ts", {
    "server-only": {},
    "./practice-persistence": { PracticeError },
    "./site-team": imports["./site-team"],
  }),
  "server-only": {},
  "node:crypto": {},
  "firebase-admin/firestore": imports["firebase-admin/firestore"],
  "@/lib/decks": {},
  "./history": imports["./history"],
  "./practice-persistence": { PracticeError },
  "./site-team": imports["./site-team"],
  "./deck-sharing": {
    audienceFields: async () => ({ visibility: "private", teamId: null }),
    writeAudience: () => {},
  },
});
test("teacher curation preserves author provenance and checks current staff", async () => {
  const { db, writes } = database();
  const result = await deckServer.mutateDeck(
    db,
    "teacher",
    {
      action: "create",
      name: "Biology",
      teacherCurated: true,
    },
    true,
  );
  assert.equal(result.deckId, "new");
  assert.equal(writes[0].data.curatedBy, "teacher");
  assert.equal(writes[0].data.visibility, "private");
  await assert.rejects(
    deckServer.mutateDeck(
      database({ role: "student", teamId: "school" }).db,
      "teacher",
      { action: "create", name: "Biology", teacherCurated: true },
      true,
    ),
    (e) => e.status === 403,
  );
});

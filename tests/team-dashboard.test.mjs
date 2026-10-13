import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
function load(path, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (id) => {
        if (id in imports) return imports[id];
        throw Error(id);
      },
      Date,
      Intl,
      Set,
      Map,
      WeakMap,
    },
  );
  return module.exports;
}
class PracticeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
const stats = load("src/lib/statistics.ts");
const teamHelpers = load("src/lib/team-dashboard.ts", {
  "./statistics": stats,
});
const server = load("src/lib/server/team-dashboard.ts", {
  "server-only": {},
  "@/lib/team-dashboard": teamHelpers,
  "./site-team": { siteTeam: () => ({ id: "school" }) },
  "./practice-persistence": { PracticeError },
  "@/lib/statistics": stats,
  "./dashboard": { timestampISO: (v) => (typeof v === "string" ? v : null) },
});
test("staff authorization requires verified current staff in configured school", async () => {
  for (const [verified, data, allowed] of [
    [true, { role: "teacher", teamId: "school" }, true],
    [true, { role: "admin", teamId: "school" }, true],
    [false, { role: "admin", teamId: "school" }, false],
    [true, { role: "student", teamId: "school" }, false],
    [true, { role: "teacher", teamId: "other" }, false],
    [true, undefined, false],
  ]) {
    const db = { doc: () => ({ get: async () => ({ data: () => data }) }) };
    if (allowed)
      assert.equal(
        await server.requireTeamStaff(db, "staff", verified),
        "school",
      );
    else
      await assert.rejects(
        server.requireTeamStaff(db, "staff", verified),
        (e) => e.status === 403,
      );
  }
});
test("roster reads only configured school members and resolves actual staff roles", async () => {
  const db = {
    collection: (path) => {
      assert.equal(path, "teams/school/members");
      return {
        get: async () => ({
          docs: [
            { id: "a", data: () => ({ displayName: "Zoe" }) },
            { id: "b", data: () => ({ displayName: "Amy" }) },
          ],
        }),
      };
    },
    doc: (path) => ({
      get: async () => ({
        data: () =>
          path === "staff/a"
            ? { role: "teacher", teamId: "school" }
            : { role: "admin", teamId: "other" },
      }),
    }),
  };
  const rows = await server.loadTeamRoster(db, "school");
  assert.equal(rows[0].uid, "b");
  assert.equal(rows[0].role, "student");
  assert.equal(rows[1].role, "teacher");
});
test("team statistics isolate current students and namespace shared session IDs", async () => {
  const seen = [];
  const docs = (entries) =>
    entries.map(([id, data]) => ({ id, data: () => data }));
  const attempt = (outcome) => ({
    sessionId: "same",
    questionIndex: 0,
    part: 0,
    outcome,
    completedAt: "2026-10-12T12:00:00Z",
    question: { category: "Science", subcategory: "Biology", difficulty: 4 },
  });
  const db = {
    doc: (path) => ({
      get: async () => ({
        data: () =>
          path === "staff/teacher"
            ? { role: "teacher", teamId: "school" }
            : undefined,
      }),
    }),
    collection: (path) => ({
      get: async () => {
        seen.push(path);
        if (path === "teams/school/assignments") return { docs: [] };
        if (path === "teams/school/members")
          return {
            docs: docs([
              ["alice", { displayName: "Alice" }],
              ["bob", { displayName: "Bob" }],
              ["teacher", { displayName: "Teacher" }],
            ]),
          };
        if (path === "users/alice/attempts")
          return { docs: docs([["a", attempt("correct")]]) };
        if (path === "users/bob/attempts")
          return { docs: docs([["b", attempt("incorrect")]]) };
        throw Error(`Unexpected path ${path}`);
      },
    }),
  };
  const result = await server.loadTeamDashboard(
    db,
    "school",
    "UTC",
    new Date("2026-10-12T16:00:00Z"),
  );
  assert.equal(result.students.length, 2);
  assert.equal(result.team.totalQuestions, 2);
  assert.equal(result.team.total.accuracy, 50);
  assert.equal(result.students[0].statistics.total.accuracy, 100);
  assert.ok(!seen.includes("users/teacher/attempts"));
});

test("heatmap separates categories and difficulties and excludes pending and future attempts", () => {
  const base = {
    sessionId: "s",
    questionIndex: 0,
    part: 0,
    outcome: "correct",
    completedAt: "2026-10-12T12:00:00Z",
    question: { category: "Science", subcategory: "Biology", difficulty: 4 },
  };
  const cells = teamHelpers.subjectDifficulty(
    [
      base,
      { ...base, part: 1, outcome: "incorrect" },
      {
        ...base,
        question: { ...base.question, difficulty: 5 },
        outcome: "skipped",
      },
      { ...base, outcome: "prompt", completedAt: null },
      { ...base, completedAt: "2027-01-01T00:00:00Z" },
    ],
    new Date("2026-10-12T16:00:00Z"),
  );
  assert.equal(cells.length, 2);
  assert.equal(cells[0].accuracy, 50);
  assert.equal(cells[0].questions, 1);
  assert.equal(cells[1].accuracy, null);
});
test("participation includes skips but excludes prompts and future records", () => {
  const now = new Date("2026-10-12T16:00:00Z");
  const a = {
    sessionId: "s",
    questionIndex: 0,
    part: 0,
    outcome: "skipped",
    completedAt: "2026-10-12T12:00:00Z",
    question: { category: "Science", difficulty: 4 },
  };
  assert.equal(teamHelpers.participation([], now).status, "never");
  const result = teamHelpers.participation(
    [
      a,
      { ...a, part: 1 },
      { ...a, sessionId: "prompt", outcome: "prompt" },
      { ...a, sessionId: "future", completedAt: "2027-01-01T00:00:00Z" },
    ],
    now,
  );
  assert.equal(result.status, "active");
  assert.equal(result.sessions, 1);
  assert.equal(result.activeDays, 1);
  assert.equal(
    teamHelpers.participation(
      [{ ...a, completedAt: "2026-09-01T12:00:00Z" }],
      now,
    ).status,
    "inactive",
  );
});

test("assignment completion enforces publication and audience and handles progress and overdue", () => {
  const now = new Date("2026-10-12T16:00:00Z");
  const a = {
    title: "Biology",
    published: true,
    studentUids: ["alice"],
    questionCount: 10,
    dueAt: "2026-10-11T00:00:00Z",
  };
  assert.equal(
    teamHelpers.assignmentCompletion("a", a, undefined, "bob", now),
    null,
  );
  assert.equal(
    teamHelpers.assignmentCompletion(
      "a",
      { ...a, published: false },
      undefined,
      "alice",
      now,
    ),
    null,
  );
  assert.equal(
    teamHelpers.assignmentCompletion(
      "a",
      { ...a, status: "cancelled" },
      undefined,
      "alice",
      now,
    ),
    null,
  );
  assert.equal(
    teamHelpers.assignmentCompletion("a", a, undefined, "alice", now).status,
    "overdue",
  );
  assert.equal(
    teamHelpers.assignmentCompletion(
      "a",
      a,
      { completedQuestions: 12 },
      "alice",
      now,
    ).completedQuestions,
    10,
  );
  assert.equal(
    teamHelpers.assignmentCompletion(
      "a",
      a,
      { completedQuestions: 10 },
      "alice",
      now,
    ).status,
    "completed",
  );
  assert.equal(
    teamHelpers.assignmentCompletion(
      "a",
      { ...a, audience: "team", dueAt: null },
      { completedQuestions: 2 },
      "bob",
      now,
    ).status,
    "in progress",
  );
});

import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

function load(path, imports = {}) {
  const compiledModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module: compiledModule,
    exports: compiledModule.exports,
    require: (id) => {
      if (id in imports) return imports[id];
      throw Error(`Unexpected import ${id}`);
    },
    URL,
    Request,
    Response,
    Intl,
    Date,
  });
  return compiledModule.exports;
}
const statistics = load("src/lib/statistics.ts");
const now = new Date("2026-10-10T16:00:00Z");
const attempt = (changes = {}) => ({
  sessionId: "session-a",
  questionIndex: 0,
  part: 0,
  outcome: "correct",
  question: { category: "Science", subcategory: "Biology", difficulty: 4 },
  completedAt: "2026-10-10T15:00:00Z",
  ...changes,
});

test("bonus parts count as separate responses but one question; prompts and skips do not reduce accuracy", () => {
  const data = statistics.buildStatistics(
    [
      attempt(),
      attempt({ part: 1, outcome: "incorrect" }),
      attempt({ part: 2, outcome: "skipped" }),
      attempt({ questionIndex: 1, outcome: "prompt", completedAt: null }),
      attempt({ sessionId: "session-b" }),
    ],
    now,
    "America/New_York",
  );
  assert.equal(data.totalQuestions, 2);
  assert.equal(data.total.attempted, 4);
  assert.equal(data.total.correct, 2);
  assert.equal(data.total.incorrect, 1);
  assert.equal(data.total.skipped, 1);
  assert.ok(Math.abs(data.total.accuracy - 200 / 3) < 1e-10);
  assert.equal(data.current.daily.questions, 2);
  assert.equal(data.categories[0].attempted, 4);
  assert.equal(data.difficulties[0].accuracy, data.total.accuracy);
});
test("empty and skipped-only data have no accuracy and chart gaps are filled", () => {
  const empty = statistics.buildStatistics([], now);
  assert.equal(empty.total.accuracy, null);
  assert.equal(empty.totalQuestions, 0);
  assert.equal(empty.activity.daily.length, 30);
  assert.equal(empty.activity.weekly.length, 12);
  assert.equal(empty.activity.monthly.length, 12);
  assert.equal(
    statistics.buildStatistics([attempt({ outcome: "skipped" })], now).total
      .accuracy,
    null,
  );
});
test("daily, Monday-week, and month boundaries follow the student's timezone including DST", () => {
  const data = statistics.buildStatistics(
    [
      attempt({ completedAt: "2026-10-10T02:00:00Z" }),
      attempt({ questionIndex: 1, completedAt: "2026-10-10T15:00:00Z" }),
      attempt({ questionIndex: 2, completedAt: "2026-10-05T02:00:00Z" }),
      attempt({ questionIndex: 3, completedAt: "2026-10-01T02:00:00Z" }),
    ],
    now,
    "America/New_York",
  );
  assert.equal(data.current.daily.attempted, 1);
  assert.equal(data.current.weekly.attempted, 2);
  assert.equal(data.current.monthly.attempted, 3);
  assert.equal(
    data.activity.daily.find((r) => r.label === "2026-09-30").attempted,
    1,
  );
  const dst = statistics.buildStatistics(
    [
      attempt({ completedAt: "2026-11-01T05:30:00Z" }),
      attempt({ part: 1, completedAt: "2026-11-01T06:30:00Z" }),
    ],
    new Date("2026-11-01T12:00:00Z"),
    "America/New_York",
  );
  assert.equal(dst.current.daily.attempted, 2);
  assert.equal(dst.current.daily.questions, 1);
});
test("recommendations require evidence, exclude skips, and separate same-named subcategories", () => {
  const rows = [0, 1, 2].map((questionIndex) =>
    attempt({ questionIndex, outcome: "incorrect" }),
  );
  rows.push(
    attempt({
      question: { category: "History", subcategory: "Biology", difficulty: 10 },
    }),
  );
  const data = statistics.buildStatistics(rows, now);
  assert.equal(data.recommendations.length, 1);
  assert.equal(data.recommendations[0].category, "Science");
  assert.equal(data.subcategories.length, 2);
  assert.deepEqual(
    Array.from(data.difficulties, (r) => r.label),
    ["4", "10"],
  );
});
test("upcoming items require publication, future date, and personal or team audience", () => {
  const data = {
    title: "Practice",
    dueAt: "2026-10-11T12:00:00Z",
    published: true,
    audience: "students",
    studentUids: ["alice"],
  };
  assert.equal(statistics.eligibleUpcoming(data, "alice", now, "dueAt"), true);
  assert.equal(statistics.eligibleUpcoming(data, "bob", now, "dueAt"), false);
  for (const changes of [
    { published: false },
    { status: "cancelled" },
    { status: "completed" },
    { dueAt: "bad" },
    { dueAt: "2026-10-09" },
  ])
    assert.equal(
      statistics.eligibleUpcoming(
        { ...data, ...changes },
        "alice",
        now,
        "dueAt",
      ),
      false,
    );
  assert.equal(
    statistics.eligibleUpcoming(
      { ...data, audience: "team" },
      "bob",
      now,
      "dueAt",
    ),
    true,
  );
});
test("dashboard reads only the requested owner's records and denies team data without membership", async () => {
  const paths = [];
  const records = {
    "users/alice/attempts": [attempt()],
    "users/bob/attempts": [attempt({ outcome: "incorrect" })],
    "users/alice/practiceSessions": [],
    "users/bob/practiceSessions": [],
    "teams/school/assignments": [
      {
        title: "Alice only",
        published: true,
        studentUids: ["alice"],
        dueAt: "2026-10-11T12:00:00Z",
      },
      {
        title: "Bob only",
        published: true,
        studentUids: ["bob"],
        dueAt: "2026-10-11T12:00:00Z",
      },
    ],
    "teams/school/events": [
      {
        title: "Tournament",
        published: true,
        audience: "team",
        type: "competition",
        startsAt: "2026-10-12T12:00:00Z",
      },
    ],
  };
  const collection = (path) => ({
    orderBy() {
      return this;
    },
    limit() {
      return this;
    },
    async get() {
      paths.push(path);
      assert.ok(path in records, `Unexpected collection ${path}`);
      return {
        docs: records[path].map((data, i) => ({
          id: String(i),
          data: () => ({ ...data }),
        })),
      };
    },
  });
  const db = {
    collection,
    doc(path) {
      return {
        collection: (name) => collection(`${path}/${name}`),
        async get() {
          paths.push(path);
          return { exists: path === "teams/school/members/alice" };
        },
      };
    },
  };
  const { loadDashboard } = load("src/lib/server/dashboard.ts", {
    "server-only": {},
    "@/lib/statistics": statistics,
    "./site-team": { siteTeam: () => ({ id: "school" }) },
  });
  const alice = await loadDashboard(db, "alice", "UTC", now);
  assert.equal(alice.total.correct, 1);
  assert.deepEqual(
    Array.from(alice.upcoming, (r) => r.title),
    ["Alice only", "Tournament"],
  );
  assert.ok(paths.every((p) => !p.includes("bob")));
  paths.length = 0;
  const bob = await loadDashboard(db, "bob", "UTC", now);
  assert.equal(bob.total.incorrect, 1);
  assert.equal(bob.upcoming.length, 0);
  assert.ok(
    paths.every(
      (p) =>
        !p.includes("alice") &&
        !p.endsWith("assignments") &&
        !p.endsWith("events"),
    ),
  );
});
test("API derives identity from authentication, ignores supplied UID, and forbids caching", async () => {
  let identity;
  const { GET } = load("src/app/api/dashboard/route.ts", {
    "@/lib/server/practice-persistence": {
      authenticatePractice: async () => ({ uid: "alice", db: {} }),
      PracticeError: class extends Error {},
    },
    "@/lib/server/dashboard": {
      loadDashboard: async (_db, uid) => {
        identity = uid;
        return { totalQuestions: 1 };
      },
    },
  });
  const response = await GET(
    new Request("http://localhost/api/dashboard?uid=bob&timeZone=UTC"),
  );
  assert.equal(identity, "alice");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Vary"), "Authorization");
  assert.equal(response.status, 200);
});

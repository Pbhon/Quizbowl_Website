import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
function load(path, imports = {}) {
  const compiledModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    module: compiledModule,
    exports: compiledModule.exports,
    require: (id) => {
      if (id in imports) return imports[id];
      throw Error(id);
    },
    URLSearchParams,
  });
  return compiledModule.exports;
}
const practice = load("src/lib/practice.ts");
const history = load("src/lib/history.ts");
class PracticeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
const server = load("src/lib/server/history.ts", {
  "server-only": {},
  "firebase-admin/firestore": {
    FieldValue: { serverTimestamp: () => "timestamp" },
  },
  "@/lib/practice": practice,
  "@/lib/history": history,
  "./practice-persistence": { PracticeError },
  "./dashboard": { timestampISO: (value) => value },
});
function fakeDB(records) {
  const reads = [];
  const writes = [];
  function ref(path) {
    return {
      id: path.split("/").at(-1),
      path,
      get: async () => {
        reads.push(path);
        return snapshot(path);
      },
      collection: (name) => collection(`${path}/${name}`),
    };
  }
  function snapshot(path) {
    return { ...ref(path), exists: path in records, data: () => records[path] };
  }
  function collection(path) {
    return {
      doc: (id = `new-${writes.length}`) => ref(`${path}/${id}`),
      orderBy: () => query(path),
    };
  }
  function query(path, offset = 0, limit = Infinity) {
    const docs = Object.keys(records)
      .filter(
        (key) =>
          key.startsWith(`${path}/`) &&
          !key.slice(path.length + 1).includes("/"),
      )
      .sort((a, b) => records[b].createdAt.localeCompare(records[a].createdAt))
      .map(snapshot);
    return {
      limit: (n) => query(path, offset, n),
      startAfter: (doc) =>
        query(path, docs.findIndex((d) => d.path === doc.path) + 1, limit),
      get: async () => {
        reads.push(path);
        const page = docs.slice(offset, offset + limit);
        return { docs: page, size: page.length };
      },
    };
  }
  return {
    collection,
    doc: ref,
    reads,
    writes,
    batch: () => ({
      create: (ref, data) => writes.push({ path: ref.path, data }),
      set: (ref, data) => writes.push({ path: ref.path, data }),
      commit: async () => {},
    }),
  };
}
const question = {
  id: "qb",
  type: "bonus",
  category: "Science",
  subcategory: "Biology",
  difficulty: 0,
  parts: ["first", "second"],
  answers: ["<b>a</b>", "b"],
  answerLines: ["a", "b"],
  leadin: "bonus",
  source: "set",
};
test("filters validate subject, difficulty zero, and outcomes", () => {
  assert.equal(
    history.matchesHistory(
      { question, outcome: "incorrect" },
      {
        category: "Science",
        subcategory: "Biology",
        difficulty: "0",
        outcome: "incorrect",
      },
    ),
    true,
  );
  for (const query of [
    "difficulty=11",
    "difficulty=00",
    "outcome=accept",
    "category=Science&subcategory=World+History",
  ])
    assert.throws(
      () => server.parseHistoryFilters(new URLSearchParams(query)),
      { status: 400 },
    );
  for (const id of ["../alice", "a/b", "", null])
    assert.throws(() => server.documentId(id), { status: 400 });
});
test("history scans beyond first batch, returns 30 matching records, and paginates without losing records", async () => {
  const records = {};
  for (let i = 0; i < 160; i++)
    records[`users/alice/attempts/a-${i}`] = {
      question,
      part: 0,
      outcome: i % 4 === 0 ? "incorrect" : "correct",
      submittedAnswer: `answer-${i}`,
      createdAt: new Date(1700000000000 + i * 1000).toISOString(),
      submissions: [],
    };
  records["users/bob/attempts/private"] = {
    question,
    createdAt: "2099-01-01",
    outcome: "incorrect",
  };
  const db = fakeDB(records);
  const first = await server.loadHistory(
    db,
    "alice",
    new URLSearchParams("outcome=incorrect"),
  );
  assert.equal(first.attempts.length, 30);
  assert.equal(first.attempts[0].id, "a-156");
  const second = await server.loadHistory(
    db,
    "alice",
    new URLSearchParams({ outcome: "incorrect", cursor: first.nextCursor }),
  );
  assert.equal(second.attempts.length, 10);
  assert.equal(second.nextCursor, null);
  assert.equal(
    new Set([...first.attempts, ...second.attempts].map((a) => a.id)).size,
    40,
  );
  assert.ok(db.reads.every((path) => path.startsWith("users/alice/")));
  await assert.rejects(
    server.loadHistory(db, "alice", new URLSearchParams("cursor=private")),
    { status: 400 },
  );
});
test("retry reads only the owner's original incorrect question; saving retains all original bonus parts", async () => {
  const db = fakeDB({
    "users/alice/attempts/missed": { question, outcome: "incorrect" },
    "users/alice/attempts/correct": { question, outcome: "correct" },
    "users/bob/decks/bob-deck": { name: "Private" },
  });
  assert.deepEqual(
    await server.historyQuestion(db, "alice", "missed", true),
    question,
  );
  await assert.rejects(server.historyQuestion(db, "alice", "correct", true), {
    status: 400,
  });
  await assert.rejects(server.historyQuestion(db, "bob", "missed", true), {
    status: 404,
  });
  await assert.rejects(
    server.saveHistoryToDeck(db, "alice", {
      attemptId: "missed",
      deckId: "bob-deck",
    }),
    { status: 404 },
  );
  await server.saveHistoryToDeck(db, "alice", {
    attemptId: "missed",
    name: " Review ",
  });
  assert.equal(db.writes[0].data.name, "Review");
  assert.deepEqual(db.writes[1].data.question, question);
  assert.ok(
    db.writes.every((write) => write.path.startsWith("users/alice/decks/")),
  );
});

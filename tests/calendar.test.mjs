import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
class PracticeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
function load(path, imports = {}) {
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
      TextEncoder,
    },
  );
  return mod.exports;
}
const helpers = load("src/lib/calendar.ts");
const server = load("src/lib/server/calendar.ts", {
  "server-only": {},
  "./site-team": { siteTeam: () => ({ id: "school" }) },
  "./practice-persistence": { PracticeError },
  "@/lib/calendar": helpers,
  "firebase-admin/firestore": {
    FieldValue: { serverTimestamp: () => "stamp" },
  },
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
  "./history": {
    documentId: (value) => {
      if (typeof value !== "string" || !/^[\w-]+$/.test(value))
        throw new PracticeError("Bad id", 400);
      return value;
    },
  },
});
function database() {
  const records = new Map([
    ["staff/admin", { role: "admin", teamId: "school" }],
    ["staff/teacher", { role: "teacher", teamId: "school" }],
    ["staff/foreign", { role: "admin", teamId: "other" }],
    ["teams/school/members/student", { displayName: "Student" }],
    [
      "teams/school/events/live",
      {
        title: "Live",
        startsAt: "2026-11-01T12:00:00.000Z",
        published: true,
        type: "event",
        rsvpEnabled: false,
      },
    ],
    [
      "teams/school/events/draft",
      {
        title: "Draft",
        startsAt: "2026-11-02T12:00:00.000Z",
        published: false,
        type: "event",
      },
    ],
  ]);
  const doc = (path) => ({ path, id: path.split("/").at(-1) });
  const snapshot = (path) => ({
    ...doc(path),
    exists: records.has(path),
    data: () => records.get(path),
  });
  const db = {
    doc,
    collection: (path) => ({
      path,
      query: true,
      doc: () => doc(`${path}/new`),
    }),
    runTransaction: async (work) =>
      work({
        get: async (ref) =>
          ref.query
            ? {
                docs: [...records.keys()]
                  .filter(
                    (path) =>
                      path.startsWith(ref.path + "/") &&
                      path.split("/").length === ref.path.split("/").length + 1,
                  )
                  .map(snapshot),
              }
            : snapshot(ref.path),
        create: (ref, data) => records.set(ref.path, data),
        update: (ref, data) =>
          records.set(ref.path, { ...records.get(ref.path), ...data }),
        set: (ref, data) => records.set(ref.path, data),
        delete: (ref) => records.delete(ref.path),
      }),
  };
  return { db, records };
}
test("school calendar hides drafts and isolates outsiders", async () => {
  const { db } = database();
  assert.equal(
    (await server.calendarWorkspace(db, "student", false)).events.length,
    1,
  );
  assert.equal(
    (await server.calendarWorkspace(db, "admin", true)).events.length,
    2,
  );
  for (const uid of ["outsider", "foreign", "admin"])
    await assert.rejects(
      server.calendarWorkspace(db, uid, false),
      (e) => e.status === 403,
    );
});
const base = {
  action: "create",
  title: "Event",
  startsAt: "2026-11-01T12:00:00.000Z",
  published: true,
};
test("only current verified school admins create or edit events", async () => {
  const { db, records } = database();
  for (const [uid, verified] of [
    ["student", true],
    ["teacher", true],
    ["foreign", true],
    ["admin", false],
  ])
    await assert.rejects(
      server.saveCalendar(db, uid, verified, base),
      (e) => e.status === 403,
    );
  await server.saveCalendar(db, "admin", true, base);
  assert.equal(records.get("teams/school/events/new").title, "Event");
  await server.saveCalendar(db, "admin", true, {
    ...base,
    action: "update",
    id: "new",
    title: "Edited",
  });
  assert.equal(records.get("teams/school/events/new").title, "Edited");
  for (const change of [
    { startsAt: "2026-02-30T12:00:00.000Z" },
    { endsAt: base.startsAt },
    { published: "true" },
    { title: "" },
    { action: "update", id: "bad/path" },
  ])
    await assert.rejects(
      server.saveCalendar(db, "admin", true, { ...base, ...change }),
      (e) => e.status === 400,
    );
});

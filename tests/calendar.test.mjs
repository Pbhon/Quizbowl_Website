import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { createHash } from "node:crypto";
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
      Buffer,
      Request,
      Response,
      URL,
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
test("calendar export escapes injection, folds Unicode, scopes stable IDs, and excludes drafts", () => {
  const { calendarICS } = load("src/lib/server/calendar-export.ts", {
    "server-only": {},
    "node:crypto": { createHash },
    "@/lib/calendar": helpers,
  });
  const event = {
    id: "one",
    title: "Quiz, tournament; " + "🏆".repeat(40),
    description: "line\r\nBEGIN:VEVENT\\escape",
    location: "School",
    startsAt: "2026-11-01T12:00:00.000Z",
    endsAt: "2026-11-01T13:00:00.000Z",
    published: true,
  };
  const output = calendarICS(
    [event, { ...event, id: "draft", published: false }],
    "school",
    new Date("2026-10-01T00:00:00.000Z"),
  );
  const unfolded = output.replace(/\r\n /g, "");
  assert.equal(unfolded.match(/\r\nBEGIN:VEVENT\r\n/g).length, 1);
  assert.ok(unfolded.includes("SUMMARY:Quiz\\, tournament\\; "));
  assert.ok(unfolded.includes("DESCRIPTION:line\\nBEGIN:VEVENT\\\\escape"));
  assert.ok(unfolded.includes("DTSTART:20261101T120000Z"));
  for (const line of output.split("\r\n"))
    assert.ok(Buffer.byteLength(line) <= 75);
  const uid = (value) => value.match(/UID:(.*)/)[1];
  assert.equal(uid(output), uid(calendarICS([event], "school")));
  assert.notEqual(uid(output), uid(calendarICS([event], "other")));
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
test("legacy event timestamps normalize without exposing internal fields", async () => {
  const { db, records } = database();
  records.set("teams/school/events/live", {
    title: "Legacy",
    published: true,
    startsAt: { toDate: () => new Date("2026-11-01T12:00:00.000Z") },
    createdBy: "private",
    responses: [{ uid: "private" }],
  });
  const event = (await server.calendarWorkspace(db, "student", true)).events[0];
  assert.equal(event.startsAt, "2026-11-01T12:00:00.000Z");
  assert.equal(event.createdBy, undefined);
  assert.equal(event.responses, undefined);
});
const base = {
  action: "create",
  title: "Event",
  startsAt: "2026-11-01T12:00:00.000Z",
  published: true,
};
test("competition dates retain their event type", async () => {
  const { db, records } = database();
  await server.saveCalendar(db, "admin", true, {
    ...base,
    type: "competition",
  });
  assert.equal(records.get("teams/school/events/new").type, "competition");
  await assert.rejects(
    server.saveCalendar(db, "admin", true, { ...base, type: "unknown" }),
    (e) => e.status === 400,
  );
});
test("practice schedules support a start and end", async () => {
  const { db, records } = database();
  await server.saveCalendar(db, "admin", true, {
    ...base,
    type: "practice",
    endsAt: "2026-11-01T13:00:00.000Z",
  });
  assert.equal(records.get("teams/school/events/new").type, "practice");
  assert.equal(
    records.get("teams/school/events/new").endsAt,
    "2026-11-01T13:00:00.000Z",
  );
});
test("deadlines follow current assignment publication, audience and due date", async () => {
  const { db, records } = database();
  const path = "teams/school/assignments/a";
  const data = {
    title: "Work",
    published: true,
    audience: "students",
    studentUids: ["student"],
    dueAt: base.startsAt,
  };
  records.set(path, data);
  assert.equal(
    (await server.calendarWorkspace(db, "student", true)).events.filter(
      (e) => e.type === "assignment",
    ).length,
    1,
  );
  for (const patch of [
    { published: false },
    { studentUids: ["someone-else"] },
    { dueAt: null },
  ]) {
    records.set(path, { ...data, ...patch });
    assert.equal(
      (await server.calendarWorkspace(db, "student", true)).events.filter(
        (e) => e.type === "assignment",
      ).length,
      0,
    );
  }
  records.set(path, { ...data, dueAt: "2026-12-01T12:00:00.000Z" });
  assert.equal(
    (await server.calendarWorkspace(db, "student", true)).events.find(
      (e) => e.type === "assignment",
    ).startsAt,
    "2026-12-01T12:00:00.000Z",
  );
});
test("RSVPs are idempotent, scoped to self and closed on unpublish or disable", async () => {
  const { db, records } = database();
  const path = "teams/school/events/live";
  records.set(path, {
    ...records.get(path),
    rsvpEnabled: true,
    startsAt: "2099-01-01T00:00:00.000Z",
  });
  for (const response of ["going", "going", "maybe"])
    await server.saveCalendar(db, "student", true, {
      action: "rsvp",
      id: "live",
      response,
      uid: "victim",
    });
  assert.equal(records.get(`${path}/rsvps/student`).response, "maybe");
  assert.equal(records.has(`${path}/rsvps/victim`), false);
  assert.equal(
    (await server.calendarWorkspace(db, "student", true)).events.find(
      (e) => e.id === "live",
    ).responses,
    undefined,
  );
  assert.equal(
    (await server.calendarWorkspace(db, "admin", true)).events.find(
      (e) => e.id === "live",
    ).responses.length,
    1,
  );
  await server.saveCalendar(db, "student", true, {
    action: "rsvp",
    id: "live",
    response: "",
  });
  assert.equal(records.has(`${path}/rsvps/student`), false);
  for (const change of [
    { published: false },
    { rsvpEnabled: false },
    { startsAt: "2000-01-01T00:00:00.000Z" },
  ]) {
    const original = records.get(path);
    records.set(path, { ...original, ...change });
    await assert.rejects(
      server.saveCalendar(db, "student", true, {
        action: "rsvp",
        id: "live",
        response: "going",
      }),
      (e) => e.status === 409,
    );
    records.set(path, original);
  }
  records.delete("teams/school/members/student");
  await assert.rejects(
    server.saveCalendar(db, "student", true, {
      action: "rsvp",
      id: "live",
      response: "going",
    }),
    (e) => e.status === 403,
  );
});
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
test("announcements use admin authoring and published school-only reads", async () => {
  const { db, records } = database();
  const body = {
    kind: "announcement",
    action: "create",
    title: "Travel update",
    description: "Meet at school.",
    published: false,
  };
  for (const uid of ["teacher", "student", "foreign"])
    await assert.rejects(
      server.saveCalendar(db, uid, true, body),
      (e) => e.status === 403,
    );
  await server.saveCalendar(db, "admin", true, body);
  assert.equal(
    (await server.calendarWorkspace(db, "student", true)).announcements.length,
    0,
  );
  assert.equal(
    (await server.calendarWorkspace(db, "admin", true)).announcements.length,
    1,
  );
  await server.saveCalendar(db, "admin", true, {
    ...body,
    action: "update",
    id: "new",
    published: true,
  });
  assert.equal(
    (await server.calendarWorkspace(db, "student", true)).announcements[0]
      .title,
    "Travel update",
  );
  records.set("staff/admin", { role: "admin", teamId: "other" });
  await assert.rejects(
    server.saveCalendar(db, "admin", true, body),
    (e) => e.status === 403,
  );
});
test("calendar API uses authenticated identity, current verification and private exports", async () => {
  const seen = [];
  const { GET, POST } = load("src/app/api/calendar/route.ts", {
    "@/lib/server/practice-persistence": {
      PracticeError,
      authenticatePractice: async () => ({ uid: "student", db: {} }),
    },
    "@/lib/firebase/admin": {
      getFirebaseAdmin: () => ({
        auth: { getUser: async () => ({ emailVerified: false }) },
      }),
    },
    "@/lib/server/calendar": {
      calendarWorkspace: async (_db, uid, verified) => {
        seen.push({ uid, verified });
        return { events: [] };
      },
      saveCalendar: async () => ({ saved: true }),
    },
    "@/lib/server/calendar-export": {
      calendarICS: () => "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
    },
    "@/lib/server/site-team": { siteTeam: () => ({ id: "school" }) },
  });
  const response = await GET(
    new Request(
      "http://localhost/api/calendar?format=ics&uid=admin&teamId=other",
    ),
  );
  assert.equal(seen[0].uid, "student");
  assert.equal(seen[0].verified, false);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Authorization");
  assert.match(response.headers.get("content-type"), /^text\/calendar/);
  for (const body of ["null", "[]", "invalid"])
    assert.equal(
      (
        await POST(
          new Request("http://localhost/api/calendar", {
            method: "POST",
            body,
          }),
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await POST(
        new Request("http://localhost/api/calendar", {
          method: "POST",
          body: " ".repeat(12001),
        }),
      )
    ).status,
    413,
  );
});

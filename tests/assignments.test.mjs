import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
function load(path, imports) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: mod, exports: mod.exports, require: id => { if (id in imports) return imports[id]; throw Error(id); }, Date, Set });
  return mod.exports;
}
class PracticeError extends Error { constructor(message, status) { super(message); this.status = status; } }
const roster = [{ uid: "student", displayName: "Student", role: "student" }, { uid: "teacher", role: "teacher" }];
const imports = {
  "server-only": {},
  "firebase-admin/firestore": { FieldValue: { serverTimestamp: () => "stamp" } },
  "./team-dashboard": { requireTeamStaff: async (_db, uid, verified) => { if (uid !== "teacher" || !verified) throw new PracticeError("Forbidden", 403); return "school"; }, loadTeamRoster: async () => roster },
  "./practice-persistence": { PracticeError },
  "./history": { documentId: value => { if (typeof value !== "string" || !/^[\w-]+$/.test(value)) throw new PracticeError("Bad id", 400); return value; } },
  "./dashboard": { timestampISO: value => value || null },
  "./decks": { deckText: (value, max, required) => { if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) throw new PracticeError("Bad text", 400); return value.trim(); } },
};
const server = load("src/lib/server/assignments.ts", imports);
function database(staff = { role: "teacher", teamId: "school" }) {
  const writes = [];
  const db = {
    doc: path => ({ path, id: path.split("/").at(-1) }),
    collection: path => ({ doc: () => ({ path: `${path}/new`, id: "new" }) }),
    runTransaction: async work => work({ get: async ref => ({ exists: false, data: () => ref.path.startsWith("staff/") ? staff : undefined }), create: (ref, data) => writes.push({ ref, data }), update: (ref, data) => writes.push({ ref, data }) }),
  };
  return { db, writes };
}
const base = { action: "create", title: " Practice ", description: "Instructions", published: true };
test("creates school-scoped assignments and rejects unverified/nonstaff writers", async () => {
  const { db, writes } = database();
  assert.equal((await server.saveAssignment(db, "teacher", true, base)).assignmentId, "new");
  assert.equal(writes[0].ref.path, "teams/school/assignments/new");
  assert.equal(writes[0].data.title, "Practice");
  assert.equal(writes[0].data.createdBy, "teacher");
  await assert.rejects(server.saveAssignment(db, "student", true, base), e => e.status === 403);
  await assert.rejects(server.saveAssignment(db, "teacher", false, base), e => e.status === 403);
  await assert.rejects(server.saveAssignment(database({ role: "teacher", teamId: "other" }).db, "teacher", true, base), e => e.status === 403);
});
test("validates assignment text, publication, actions and update existence", async () => {
  for (const changed of [{ title: " " }, { title: "a".repeat(121) }, { published: "yes" }, { action: "delete" }]) {
    const { db, writes } = database();
    await assert.rejects(server.saveAssignment(db, "teacher", true, { ...base, ...changed }), e => e.status === 400);
    assert.equal(writes.length, 0);
  }
  await assert.rejects(server.saveAssignment(database().db, "teacher", true, { ...base, action: "update", id: "missing" }), e => e.status === 404);
});

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
const baseImports = {
  "server-only": {},
  "./practice-persistence": { PracticeError },
  "./site-team": { siteTeam: () => ({ id: "school" }) },
};
const permissions = load("src/lib/server/deck-permissions.ts", baseImports);
const question = {
  id: "q",
  type: "tossup",
  leadin: "",
  parts: ["Question"],
  answers: ["Answer"],
  answerLines: ["Answer"],
};
const decks = load("src/lib/server/decks.ts", {
  "@/lib/clues": load("src/lib/clues.ts", {}),
  ...baseImports,
  "./deck-permissions": permissions,
  "node:crypto": { createHash },
  "firebase-admin/firestore": {
    FieldValue: { serverTimestamp: () => "stamp" },
  },
  "@/lib/decks": {},
  "./history": {
    documentId: (value) => value,
    historyQuestion: async () => question,
  },
  "./deck-sharing": {
    audienceFields: async (_db, _tx, _uid, _id, visibility) => ({
      visibility: visibility || "private",
      teamId: null,
    }),
    writeAudience: () => {},
    shareRef: (db, _teamId, uid, id) => db.doc(`share/${uid}/${id}`),
  },
});
function fixture(
  staff = { role: "teacher", teamId: "school" },
  member = true,
  curatedBy = "owner",
) {
  const records = new Map([
    [
      "users/owner/decks/deck",
      { name: "Deck", ...(curatedBy == null ? {} : { curatedBy }) },
    ],
    [
      "users/owner/decks/deck/questions/card",
      { question, originalQuestion: question },
    ],
  ]);
  if (staff) records.set("staff/owner", staff);
  if (member) records.set("teams/school/members/owner", {});
  const writes = [];
  const ref = (path) => ({
    path,
    id: path.split("/").at(-1),
    collection: (name) => ({
      doc: (id = "new") => ref(`${path}/${name}/${id}`),
    }),
  });
  const db = {
    doc: ref,
    collection: (path) => ({ doc: () => ref(`${path}/new`) }),
    recursiveDelete: async () => {},
    runTransaction: async (work) =>
      work({
        get: async (ref) => {
          assert.equal(
            writes.length,
            0,
            "permissions must be checked before writes",
          );
          return {
            exists: records.has(ref.path),
            data: () => records.get(ref.path),
          };
        },
        create: (ref, data) => writes.push({ path: ref.path, data }),
        set: (ref, data) => writes.push({ path: ref.path, data }),
        update: (ref, data) => writes.push({ path: ref.path, data }),
        delete: (ref) => writes.push({ path: ref.path, deleted: true }),
      }),
  };
  return { db, writes };
}
const edits = [
  { action: "update", deckId: "deck", name: "New", tags: [], description: "" },
  { action: "delete", deckId: "deck" },
  {
    action: "editCard",
    deckId: "deck",
    cardId: "card",
    parts: ["New question"],
    answerLines: ["Answer"],
  },
  { action: "removeCard", deckId: "deck", cardId: "card" },
  { action: "save", attemptId: "attempt", deckIds: ["deck"] },
  { action: "shareTeacher", deckId: "deck", visibility: "team" },
];
test("all teacher-deck mutation paths reject revoked, unverified, removed and wrong-school creators", async () => {
  for (const [staff, member, verified, creator] of [
    [null, true, true, "owner"],
    [{ role: "student", teamId: "school" }, true, true, "owner"],
    [{ role: "teacher", teamId: "other" }, true, true, "owner"],
    [{ role: "teacher", teamId: "school" }, false, true, "owner"],
    [{ role: "teacher", teamId: "school" }, true, false, "owner"],
    [{ role: "teacher", teamId: "school" }, true, true, "other-teacher"],
  ]) {
    for (const body of edits) {
      const { db, writes } = fixture(staff, member, creator);
      await assert.rejects(
        decks.mutateDeck(db, "owner", body, verified),
        (error) => error.status === 403,
      );
      assert.equal(writes.length, 0);
    }
  }
});
test("current verified teacher/admin creators can edit; student personal decks remain editable", async () => {
  for (const role of ["teacher", "admin"]) {
    for (const body of edits) {
      const { db, writes } = fixture({ role, teamId: "school" });
      await decks.mutateDeck(db, "owner", body, true);
      assert.ok(writes.length > 0);
    }
  }
  const { db, writes } = fixture(null, false, null);
  await decks.mutateDeck(db, "owner", edits[0], false);
  assert.equal(writes[0].data.name, "New");
});

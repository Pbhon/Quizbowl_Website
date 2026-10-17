import test from "node:test";
import assert from "node:assert/strict";
import { loadBackend } from "./helpers/backend.mjs";
class PracticeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
function fixture({
  authenticated = true,
  allowed = true,
  rows = [{}],
  packageError = false,
} = {}) {
  let exports = 0,
    packages = 0;
  const route = loadBackend("src/app/api/decks/export/route.ts", {
    "@/lib/server/practice-persistence": {
      PracticeError,
      authenticatePractice: async () => {
        if (!authenticated) throw new PracticeError("Sign in", 401);
        return { uid: "owner", db: {} };
      },
    },
    "@/lib/server/decks": {
      exportDeck: async (_db, uid) => {
        assert.equal(uid, "owner");
        exports++;
        if (!allowed) throw new PracticeError("Access revoked", 403);
        return { deck: { name: "Deck" }, key: "owner/deck" };
      },
    },
    "@/lib/anki-export": { exportRows: () => rows },
    "@/lib/server/anki-package": {
      ankiPackage: async () => {
        packages++;
        if (packageError) throw Error("private filesystem path and credential");
        return new Uint8Array([80, 75, 3, 4]);
      },
    },
  });
  return {
    post: (body) =>
      route.POST(
        new Request("http://localhost/api/decks/export", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      ),
    exports: () => exports,
    packages: () => packages,
  };
}
test("export endpoint enforces authentication, live access and private attachment headers", async () => {
  assert.equal(
    (await fixture({ authenticated: false }).post({ deckId: "deck" })).status,
    401,
  );
  const revoked = fixture({ allowed: false });
  assert.equal((await revoked.post({ sharedId: "share" })).status, 403);
  assert.equal(revoked.packages(), 0);
  const response = await fixture().post({ deckId: "deck" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("vary"), "Authorization");
  assert.match(
    response.headers.get("content-disposition"),
    /attachment.*quizbowl.apkg/,
  );
});
test("export rejects forged scope, conflicting sources, bad filters, excessive rows and empty results", async () => {
  for (const body of [
    { deckId: "deck", ownerUid: "victim" },
    { deckId: "deck", sharedId: "share" },
    { options: { difficulty: "11" } },
    { options: { kind: "other" } },
    { options: { complexity: "other" } },
    { deckId: "x".repeat(5000) },
  ]) {
    const f = fixture();
    assert.ok([400, 413].includes((await f.post(body)).status));
    assert.equal(f.packages(), 0);
  }
  for (const [rows, status] of [
    [[], 400],
    [Array(5001).fill({}), 413],
  ]) {
    const f = fixture({ rows });
    assert.equal((await f.post({ deckId: "deck" })).status, status);
    assert.equal(f.packages(), 0);
  }
  const response = await fixture({ packageError: true }).post({
    deckId: "deck",
  });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("credential"));
});

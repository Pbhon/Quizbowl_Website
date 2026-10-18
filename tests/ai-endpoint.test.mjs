import test from "node:test";
import assert from "node:assert/strict";
import { loadBackend } from "./helpers/backend.mjs";
class PracticeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
class GenerationError extends PracticeError {
  constructor(message, status, retryAt) {
    super(message, status);
    this.retryAt = retryAt;
  }
}
function fixture(failure) {
  const calls = [];
  const route = loadBackend("src/app/api/ai/clues/route.ts", {
    "@/lib/firebase/admin": {
      getFirebaseAdmin: () => ({
        auth: { getUser: async () => ({ emailVerified: true }) },
      }),
    },
    "@/lib/server/practice-persistence": {
      PracticeError,
      authenticatePractice: async () => ({
        uid: "authenticated",
        db: "database",
      }),
    },
    "@/lib/server/generation-error": { GenerationError },
    "@/lib/server/ai-generation": {
      generateSavedClues: async (...args) => {
        calls.push(args);
        if (failure) throw failure;
        return { cached: true };
      },
      savedClueStatus: async (...args) => {
        calls.push(args);
        return { generation: { status: "pending" } };
      },
    },
  });
  return {
    route,
    calls,
    post: (body) =>
      route.POST(
        new Request("http://localhost/api/ai/clues", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      ),
  };
}
test("clue endpoint accepts only saved selectors and explicit replacement options", async () => {
  const f = fixture();
  for (const body of [
    null,
    [],
    { deckId: "deck", cardId: "card", prompt: "forged" },
    { uid: "victim" },
    { regenerate: "true" },
    { expectedRevision: "revision" },
    { regenerate: true, expectedRevision: 42 },
  ])
    assert.equal((await f.post(body)).status, 400);
  assert.equal(f.calls.length, 0);
  const result = await f.post({
    deckId: "deck",
    cardId: "card",
    regenerate: true,
    expectedRevision: "revision",
  });
  assert.equal(result.status, 200);
  assert.equal(f.calls[0][1], "authenticated");
  assert.equal(f.calls[0][4], true);
  assert.equal(f.calls[0][5].expectedRevision, "revision");
  assert.match(result.headers.get("Cache-Control"), /private, no-store/);
});
test("read-only status rejects ambiguous selectors and never calls generation", async () => {
  const f = fixture();
  for (const query of [
    "",
    "deckId=deck",
    "deckId=deck&cardId=card&uid=victim",
    "deckId=one&deckId=two&cardId=card",
  ])
    assert.equal(
      (await f.route.GET(new Request(`http://localhost/api/ai/clues?${query}`)))
        .status,
      400,
    );
  assert.equal(f.calls.length, 0);
  const response = await f.route.GET(
    new Request("http://localhost/api/ai/clues?deckId=deck&cardId=card"),
  );
  assert.equal((await response.json()).generation.status, "pending");
  assert.equal(f.calls[0].length, 5);
});
test("provider cooldowns expose a safe retry time and Retry-After header", async () => {
  const retryAt = Date.now() + 180000;
  const f = fixture(new GenerationError("Retry later.", 429, retryAt));
  const response = await f.post({ deckId: "deck", cardId: "card" });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).retryAt, retryAt);
  assert.ok(Number(response.headers.get("Retry-After")) >= 179);
});

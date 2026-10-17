import test from "node:test";
import assert from "node:assert/strict";
import { loadBackend } from "./helpers/backend.mjs";
import { memoryFirestore } from "./helpers/memory-firestore.mjs";
const question = {
  id: "original",
  type: "tossup",
  leadin: "",
  parts: ["This molecule has a double helix."],
  answers: ["DNA"],
  answerLines: ["DNA"],
};
const clue = {
  clue: "Name the double-helix molecule.",
  part: 0,
  complexity: "simple",
  sourceExcerpt: "double helix",
};
function fixture(fetcher, env = {}) {
  let calls = 0;
  const server = loadBackend(
    "src/lib/server/ai-generation.ts",
    {
      "firebase-admin/firestore": {
        FieldValue: {
          serverTimestamp: () => "server-time",
          increment: (increment) => ({ increment }),
        },
      },
    },
    {
      process: {
        env: {
          GEMINI_API_KEY: "private-test-key",
          GEMINI_MODEL: "test-model",
          GEMINI_GENERATION_ENABLED: "true",
          ...env,
        },
      },
      fetch: async (url, init) => {
        calls++;
        assert.equal(init.headers["x-goog-api-key"], "private-test-key");
        assert.ok(!url.includes("private-test-key"));
        assert.ok(!init.body.includes("private note"));
        return fetcher
          ? fetcher()
          : Response.json({
              candidates: [
                {
                  finishReason: "STOP",
                  content: { parts: [{ text: JSON.stringify([clue]) }] },
                },
              ],
            });
      },
    },
  );
  const db = memoryFirestore(
    {
      "users/one/decks/deck": { name: "Deck" },
      "users/one/decks/deck/questions/card": {
        question,
        notes: "private note",
      },
      "users/two/decks/deck": { name: "Deck" },
      "users/two/decks/deck/questions/card": { question },
    },
    true,
  );
  return {
    db,
    calls: () => calls,
    generate: (uid = "one", verified = true, deck = "deck") =>
      server.generateSavedClues(db, uid, deck, "card", verified),
  };
}
test("generation requires verified ownership and explicit configuration before any provider call", async () => {
  const f = fixture();
  await assert.rejects(f.generate("one", false), { status: 403 });
  await assert.rejects(f.generate("victim"), { status: 404 });
  await assert.rejects(f.generate("one", true, "../../victim"), {
    status: 400,
  });
  assert.equal(f.calls(), 0);
  const disabled = fixture(undefined, { GEMINI_GENERATION_ENABLED: "false" });
  await assert.rejects(disabled.generate(), { status: 503 });
  assert.equal(disabled.calls(), 0);
});
test("concurrent generation leases make one provider call; other owners reuse validated cache without quota", async () => {
  const f = fixture();
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => f.generate()),
  );
  assert.ok(results.some((result) => result.status === "fulfilled"));
  assert.equal(f.calls(), 1);
  assert.equal((await f.generate("two")).cached, true);
  assert.equal(f.calls(), 1);
  assert.equal(
    [...f.db.records.keys()].some((key) =>
      key.startsWith("users/two/aiUsage/"),
    ),
    false,
  );
  assert.equal(
    f.db.records.get("users/two/decks/deck/questions/card").identifiers.length,
    1,
  );
});
test("invalid output, provider rate limits and cooldowns never save invalid clues or leak provider errors", async () => {
  for (const response of [
    () => Response.json({ candidates: [] }),
    () => new Response("secret-provider-detail", { status: 429 }),
  ]) {
    const f = fixture(response);
    await assert.rejects(
      f.generate(),
      (error) =>
        [429, 502].includes(error.status) &&
        !error.message.includes("secret-provider-detail"),
    );
    assert.equal(
      f.db.records.get("users/one/decks/deck/questions/card").identifiers,
      undefined,
    );
    await assert.rejects(f.generate(), { status: 409 });
    assert.equal(f.calls(), 1);
  }
});
test("durable daily quotas prevent provider calls and stale leases can recover", async () => {
  const f = fixture();
  const day = new Date().toISOString().slice(0, 10);
  f.db.records.set(`users/one/aiUsage/${day}`, { count: 20 });
  await assert.rejects(f.generate(), { status: 429 });
  assert.equal(f.calls(), 0);
  f.db.records.delete(`users/one/aiUsage/${day}`);
  await f.generate();
  const cacheKey = [...f.db.records.keys()].find((key) =>
    key.startsWith("aiClueCache/"),
  );
  f.db.records.set(cacheKey, {
    status: "generating",
    token: "dead-worker",
    leaseUntil: 0,
  });
  await f.generate();
  assert.equal(f.calls(), 2);
});

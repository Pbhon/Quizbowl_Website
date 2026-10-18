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
        assert.match(url, /\/v1beta\/models\/test-model:generateContent$/);
        const body = JSON.parse(init.body);
        assert.equal(
          body.generationConfig.responseFormat.text.mimeType,
          "application/json",
        );
        assert.equal(
          body.generationConfig.responseFormat.text.schema.type,
          "array",
        );
        assert.equal(body.generationConfig.maxOutputTokens, 4096);
        assert.match(
          body.systemInstruction.parts[0].text,
          /simple giveaway identifiers/,
        );
        assert.equal(init.cache, "no-store");
        assert.ok(init.signal instanceof AbortSignal);
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
    status: (uid = "one") =>
      server.savedClueStatus(db, uid, "deck", "card", true),
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

test("deleting a saved card during generation never recreates it on delivery", async () => {
  let f;
  f = fixture(async () => {
    f.db.records.delete("users/one/decks/deck/questions/card");
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify([clue]) }] },
        },
      ],
    });
  });
  await assert.rejects(f.generate(), { status: 404 });
  assert.equal(f.db.records.has("users/one/decks/deck/questions/card"), false);
});

test("every request validates Firebase cache before quota; corrupt cache is repaired", async () => {
  const f = fixture();
  await f.generate();
  const day = new Date().toISOString().slice(0, 10);
  f.db.records.set(`users/one/aiUsage/${day}`, { count: 20 });
  assert.equal((await f.generate()).cached, true);
  assert.equal(f.calls(), 1);
  const key = [...f.db.records.keys()].find((key) =>
    key.startsWith("aiClueCache/"),
  );
  f.db.records.set(key, {
    status: "completed",
    identifiers: [{ ...clue, sourceExcerpt: "invented" }],
  });
  await assert.rejects(f.generate(), { status: 429 });
  f.db.records.delete(`users/one/aiUsage/${day}`);
  assert.equal((await f.generate()).cached, false);
  assert.equal(f.calls(), 2);
});

test("cross-student cache reuse never copies personal edits or restores removed clues", async () => {
  const f = fixture();
  await f.generate();
  const path = "users/one/decks/deck/questions/card";
  const personal = f.db.records.get(path);
  personal.identifiers[0].clue = "My personal study wording";
  personal.identifiersEdited = true;
  f.db.records.set(path, personal);
  assert.equal(
    (await f.generate()).identifiers[0].clue,
    "My personal study wording",
  );
  assert.notEqual(
    (await f.generate("two")).identifiers[0].clue,
    "My personal study wording",
  );
  personal.identifiers = [];
  f.db.records.set(path, personal);
  assert.equal((await f.generate()).identifiers.length, 0);
  assert.equal(f.calls(), 1);
  const shared = [...f.db.records].filter(([path]) =>
    path.startsWith("aiClueCache/"),
  );
  assert.equal(shared.length, 1);
  assert.ok(!JSON.stringify(shared).includes("personal"));
  assert.ok(!JSON.stringify(shared).includes("private note"));
});

test("a fenced worker cannot overwrite a replacement cache or mark it failed", async () => {
  let f;
  f = fixture(() => {
    const key = [...f.db.records.keys()].find((key) =>
      key.startsWith("aiClueCache/"),
    );
    f.db.records.set(key, {
      status: "completed",
      token: "replacement",
      identifiers: [clue],
    });
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify([clue]) }] },
        },
      ],
    });
  });
  await assert.rejects(f.generate(), { status: 409 });
  const saved = [...f.db.records].find(([path]) =>
    path.startsWith("aiClueCache/"),
  )[1];
  assert.equal(saved.status, "completed");
  assert.equal(saved.token, "replacement");
  assert.equal(
    f.db.records.get("users/one/decks/deck/questions/card").identifiers,
    undefined,
  );
});

test("saved status is read-only, owner-scoped and exposes all lifecycle states without fencing tokens", async () => {
  let f;
  f = fixture(async () => {
    const status = await f.status();
    assert.equal(status.generation.status, "generating");
    assert.ok(!JSON.stringify(status).includes("token"));
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify([clue]) }] },
        },
      ],
    });
  });
  assert.equal((await f.status()).generation.status, "pending");
  assert.equal(f.calls(), 0);
  await assert.rejects(f.status("victim"), { status: 404 });
  await f.generate();
  assert.equal((await f.status()).generation.status, "completed");
  const failure = fixture(() => new Response("private", { status: 429 }));
  await assert.rejects(failure.generate(), { status: 429 });
  assert.equal((await failure.status()).generation.status, "failed");
  assert.ok((await failure.status()).generation.retryAt > Date.now());
});

test("provider Retry-After and bounded failures persist safe cooldowns without automatic retries", async () => {
  const f = fixture(
    () =>
      new Response("private provider message", {
        status: 429,
        headers: { "Retry-After": "180" },
      }),
  );
  const before = Date.now();
  await assert.rejects(
    f.generate(),
    (error) =>
      error.status === 429 &&
      error.retryAt >= before + 180000 &&
      !error.message.includes("private provider"),
  );
  assert.ok((await f.status()).generation.retryAt >= before + 180000);
  await assert.rejects(f.generate(), { status: 409 });
  assert.equal(f.calls(), 1);
  for (const response of [
    () => new Response("x".repeat(128001)),
    () => {
      throw new DOMException("private timeout detail", "TimeoutError");
    },
    () => Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }] }),
    () =>
      Response.json({
        candidates: [
          { finishReason: "STOP", content: { parts: [{ text: "not json" }] } },
        ],
      }),
  ]) {
    const failure = fixture(response);
    await assert.rejects(
      failure.generate(),
      (error) =>
        error.status === 502 &&
        error.retryAt > Date.now() &&
        !error.message.includes("private"),
    );
    assert.equal((await failure.status()).generation.status, "failed");
    assert.equal(failure.calls(), 1);
  }
});

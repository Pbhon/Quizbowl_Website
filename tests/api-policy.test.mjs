import test from "node:test";
import assert from "node:assert/strict";
import { loadBackend } from "./helpers/backend.mjs";
import { memoryFirestore } from "./helpers/memory-firestore.mjs";
const policy = loadBackend("src/lib/server/api-policy.ts");
test("durable API limits serialize concurrent instances, separate users and reset each minute", async () => {
  const db = memoryFirestore({}, true);
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, () =>
      policy.enforceApiLimit(db, "one", "/api/decks/export", 120000),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 6);
  assert.ok(
    results
      .filter((r) => r.status === "rejected")
      .every((r) => r.reason.status === 429 && r.reason.retryAfter === 60),
  );
  await policy.enforceApiLimit(db, "two", "/api/decks/export", 120000);
  await policy.enforceApiLimit(db, "one", "/api/decks/export", 180000);
  assert.equal(
    [...db.records.keys()].some((key) => key.includes("one")),
    false,
  );
  assert.ok(
    [...db.records.values()].every((value) => value.expiresAt instanceof Date),
  );
});
test("body cap counts streamed UTF-8 bytes even without content length and preserves the route body", async () => {
  const small = new Request("http://localhost/api", {
    method: "POST",
    body: "hello",
  });
  await policy.assertRequestSize(small, 5);
  assert.equal(await small.text(), "hello");
  const large = new Request("http://localhost/api", {
    method: "POST",
    body: "ééé",
  });
  await assert.rejects(policy.assertRequestSize(large, 5), { status: 413 });
  await assert.rejects(
    policy.assertRequestSize(
      new Request("http://localhost", { headers: { "content-length": "999" } }),
      5,
    ),
    { status: 413 },
  );
});
test("proxy verifies identity rather than trusting forwarded IDs, denies cross-origin requests and fails closed", async () => {
  const calls = [];
  const route = loadBackend("src/proxy.ts", {
    "next/server": {
      NextResponse: { next: ({ headers }) => new Response(null, { headers }) },
    },
    "@/lib/firebase/admin": {
      getFirebaseAdmin: () => ({
        db: {},
        auth: {
          verifyIdToken: async (token, revoked) => {
            assert.equal(revoked, true);
            if (token !== "valid") throw Error("private auth details");
            return { uid: "verified-owner" };
          },
        },
      }),
    },
    "@/lib/server/api-policy": {
      ...policy,
      enforceApiLimit: async (_db, uid, path) => calls.push([uid, path]),
    },
  });
  function request(headers = {}) {
    const req = new Request("http://localhost/api/history", {
      headers: { host: "localhost", ...headers },
    });
    req.nextUrl = new URL(req.url);
    return req;
  }
  const response = await route.proxy(
    request({ authorization: "Bearer valid", "x-user-id": "victim" }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], ["verified-owner", "/api/history"]);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(
    (await route.proxy(request({ origin: "https://attacker.example" }))).status,
    403,
  );
  assert.equal(
    (await route.proxy(request({ authorization: "Bearer fake" }))).status,
    401,
  );
  assert.equal(calls.length, 1);
});
test("answer check cache coalesces concurrent checks, clones results and never caches failures or random draws", async () => {
  let calls = 0,
    fail = false;
  const upstream = loadBackend(
    "src/lib/server/qbreader.ts",
    {},
    {
      fetch: async () => {
        calls++;
        if (fail) return new Response("private details", { status: 500 });
        return Response.json({ directive: "accept" });
      },
    },
  );
  const params = new URLSearchParams({ answerline: "DNA", givenAnswer: "dna" });
  const results = await Promise.all(
    Array.from({ length: 5 }, () => upstream.qbreader("check-answer", params)),
  );
  assert.equal(calls, 1);
  results[0].directive = "reject";
  assert.equal(
    (await upstream.qbreader("check-answer", params)).directive,
    "accept",
  );
  await upstream.qbreader("random-tossup", params);
  await upstream.qbreader("random-tossup", params);
  assert.equal(calls, 3);
  fail = true;
  const other = new URLSearchParams({ givenAnswer: "other" });
  await assert.rejects(upstream.qbreader("check-answer", other));
  await assert.rejects(upstream.qbreader("check-answer", other));
  assert.equal(calls, 5);
});

import test from "node:test";
import assert from "node:assert/strict";
import { loadBackend } from "./helpers/backend.mjs";

function usageFixture() {
  let calls = 0;
  let now = Date.parse("2026-10-18T23:59:00Z");
  let used = 3;
  let fail = false;
  const timers = new Map(),
    intervals = new Map();
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  const usage = loadBackend(
    "src/lib/generation-usage-client.ts",
    {},
    {
      window,
      document,
      Date: { now: () => now },
      setTimeout: (callback, delay) => {
        const id = {};
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      setInterval: (callback) => {
        const id = {};
        intervals.set(id, callback);
        return id;
      },
      clearInterval: (id) => intervals.delete(id),
      fetch: async (url, options) => {
        assert.equal(url, "/api/ai/usage");
        assert.equal(options.cache, "no-store");
        assert.match(options.headers.Authorization, /^Bearer account-/);
        calls++;
        if (fail)
          return Response.json(
            { error: "private backend details" },
            { status: 503 },
          );
        return Response.json({
          usage: {
            used,
            limit: 20,
            remaining: 20 - used,
            resetsAt: now + 60000,
          },
        });
      },
    },
  );
  const user = { getIdToken: async () => "account-one" };
  return {
    usage,
    user,
    timers,
    intervals,
    window,
    document,
    calls: () => calls,
    advance: () => {
      now += 60001;
      used = 0;
    },
    setUsed: (value) => {
      used = value;
    },
    fail: () => {
      fail = true;
    },
  };
}

test("many controls share a single allowance read/timer, while accounts stay separate", async () => {
  const f = usageFixture();
  const store = f.usage.generationUsageStore(f.user);
  assert.equal(store, f.usage.generationUsageStore(f.user));
  const stops = Array.from({ length: 20 }, () => store.subscribe(() => {}));
  await store.refresh();
  assert.equal(f.calls(), 1);
  assert.equal(f.intervals.size, 1);
  assert.equal(store.getSnapshot().usage.remaining, 17);
  const other = f.usage.generationUsageStore({
    getIdToken: async () => "account-two",
  });
  assert.equal(other.getSnapshot().usage, null);
  f.setUsed(4);
  await f.usage.refreshGenerationUsage(f.user);
  assert.equal(store.getSnapshot().usage.remaining, 16);
  stops.forEach((stop) => stop());
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timers.size, 0);
});

test("UTC reset and tab focus re-read durable usage; read failures are explicit", async () => {
  const f = usageFixture();
  const store = f.usage.generationUsageStore(f.user);
  const stop = store.subscribe(() => {});
  await store.refresh();
  const reset = [...f.timers.values()][0];
  assert.equal(reset.delay, 60100);
  f.advance();
  reset.callback();
  await store.refresh();
  assert.equal(store.getSnapshot().usage.used, 0);
  f.advance();
  f.setUsed(20);
  f.window.dispatchEvent(new Event("focus"));
  await store.refresh();
  assert.equal(store.getSnapshot().usage.remaining, 0);
  f.fail();
  await store.refresh();
  assert.match(store.getSnapshot().error, /could not be refreshed/);
  assert.doesNotMatch(store.getSnapshot().error, /private backend/);
  stop();
});

test("failed provider attempts refresh the same usage store without hiding generation errors", async () => {
  const f = usageFixture();
  const store = f.usage.generationUsageStore(f.user);
  const stop = store.subscribe(() => {});
  await store.refresh();
  const client = loadBackend(
    "src/lib/clue-client.ts",
    {
      "./generation-usage-client": f.usage,
    },
    {
      fetch: async () => {
        f.setUsed(4);
        return Response.json(
          { error: "Provider unavailable." },
          { status: 502 },
        );
      },
    },
  );
  await assert.rejects(client.requestClues(f.user, "deck", "card"), {
    message: "Provider unavailable.",
    status: 502,
  });
  assert.equal(store.getSnapshot().usage.used, 4);
  assert.equal(f.calls(), 2);
  stop();
});

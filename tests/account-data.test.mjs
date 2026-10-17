import test from "node:test";
import assert from "node:assert/strict";
import { loadBackend } from "./helpers/backend.mjs";
import { memoryFirestore } from "./helpers/memory-firestore.mjs";
import {
  expiredSession,
  retentionCutoff,
} from "../scripts/data-maintenance.mjs";
const privacy = loadBackend("src/lib/server/account-data.ts", {
  "firebase-admin/firestore": {
    FieldValue: { serverTimestamp: () => "server-time" },
  },
});
test("sensitive data operations require recent authentication and reject future timestamps", () => {
  const now = Date.now();
  privacy.requireRecentAuthentication(now / 1000, now);
  for (const time of [0, NaN, (now - 301000) / 1000, (now + 61000) / 1000])
    assert.throws(() => privacy.requireRecentAuthentication(time, now), {
      status: 401,
    });
});
test("self deletion requests are durable and idempotent across concurrent transactions", async () => {
  const db = memoryFirestore({}, true);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => privacy.requestAccountDeletion(db, "one")),
  );
  assert.ok(results.every((r) => r.status === "requested"));
  assert.equal(db.records.size, 1);
  assert.equal(db.records.get("privacyJobs/one").status, "requested");
});
test("retention requires an explicit bounded policy and preserves sessions with recent activity", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  for (const days of [undefined, 0, -1, 29, 3651, 1.5])
    assert.throws(() => retentionCutoff(days, now));
  const cutoff = retentionCutoff(365, now);
  assert.equal(
    expiredSession({ createdAt: "2024-01-01T00:00:00Z" }, cutoff),
    true,
  );
  assert.equal(
    expiredSession(
      { createdAt: "2024-01-01T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z" },
      cutoff,
    ),
    false,
  );
  assert.equal(expiredSession({ createdAt: "bad timestamp" }, cutoff), false);
});

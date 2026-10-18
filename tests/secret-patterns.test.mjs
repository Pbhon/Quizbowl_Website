import test from "node:test";
import assert from "node:assert/strict";
import { credentialIndicators } from "../scripts/secret-patterns.mjs";

test("the secret guard detects current and legacy Google keys without returning them", () => {
  for (const key of [
    "AQ." + "x".repeat(48),
    "AI" + "za" + "x".repeat(35),
    "-----BEGIN " + "PRIVATE KEY-----",
  ]) {
    const result = credentialIndicators(`const credential = '${key}';`);
    assert.equal(result.length, 1);
    assert.ok(!JSON.stringify(result).includes(key));
  }
  for (const text of [
    "AQ.example",
    "GEMINI_API_KEY=",
    "const key = process.env.GEMINI_API_KEY;",
  ])
    assert.equal(credentialIndicators(text).length, 0);
});

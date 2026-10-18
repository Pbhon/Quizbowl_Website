import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Walk local imports, so a future indirect dependency cannot add generation to
// an ordinary request unnoticed. Type-only imports do not execute.
function graph(entry, seen = new Set()) {
  const file = path.resolve(entry);
  if (seen.has(file)) return seen;
  seen.add(file);
  const source = readFileSync(file, "utf8");
  assert.doesNotMatch(
    source,
    /generativelanguage\.googleapis|generateSavedClues|requestClues|\/api\/ai\/clues/,
  );
  for (const match of source.matchAll(
    /import\s+(?!type\b)[\s\S]*?from\s+["']([^"']+)["']/g,
  )) {
    const id = match[1];
    const base = id.startsWith("@/")
      ? path.resolve("src", id.slice(2))
      : id.startsWith(".")
        ? path.resolve(path.dirname(file), id)
        : null;
    if (!base) continue;
    const next = [base + ".ts", base + ".tsx"].find(existsSync);
    if (next) graph(next, seen);
  }
  return seen;
}

test("ordinary fetch and answer routes have no direct or transitive generation dependency", () => {
  for (const route of ["questions", "check-answer", "attempts"])
    graph(`src/app/api/practice/${route}/route.ts`);
});

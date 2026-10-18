import test from "node:test";
import assert from "node:assert/strict";
import { loadBackend } from "./helpers/backend.mjs";
const cache = loadBackend("src/lib/server/clue-cache.ts");
const question = {
  id: "source",
  type: "tossup",
  leadin: "",
  parts: ["This molecule has a double helix."],
  answers: ["DNA"],
  answerLines: ["<b>DNA</b>"],
};
test("cache identities share original content and invalidate changed answers, text and model", () => {
  const key = cache.clueCacheKey(question, "model");
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key, cache.clueCacheKey({ ...question }, "model"));
  for (const changes of [
    { parts: ["Other text"] },
    { answers: ["RNA"] },
    { answerLines: ["RNA"] },
  ])
    assert.notEqual(
      key,
      cache.clueCacheKey({ ...question, ...changes }, "model"),
    );
  assert.notEqual(key, cache.clueCacheKey(question, "other"));
});
test("generated clues require real excerpts and valid part bindings; model answers are discarded", () => {
  const valid = {
    clue: "Name the double-helix molecule.",
    part: 0,
    complexity: "simple",
    sourceExcerpt: "double helix",
    answer: "wrong",
  };
  const cards = cache.validateClues([valid], question);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].answer, undefined);
  for (const value of [
    [],
    [valid, valid],
    [{ ...valid, part: 1 }],
    [{ ...valid, sourceExcerpt: "invented" }],
    [{ ...valid, complexity: "other" }],
    [{ ...valid, clue: " " }],
  ])
    assert.throws(() => cache.validateClues(value, question));
});

test("intermediate identifiers retain a distinctive source clue and complexity", () => {
  const [card] = cache.validateClues(
    [
      {
        clue: "Which molecule has a double helix?",
        part: 0,
        complexity: "intermediate",
        sourceExcerpt: "double helix",
      },
    ],
    question,
  );
  assert.equal(card.complexity, "intermediate");
  assert.equal(card.sourceExcerpt, "double helix");
});

test("complex early-buzzer identifiers preserve specialized opening evidence", () => {
  const source = {
    ...question,
    parts: [
      "Its B form has a major and minor groove. This molecule has a double helix.",
    ],
  };
  const [card] = cache.validateClues(
    [
      {
        clue: "Which molecule's B form has major and minor grooves?",
        part: 0,
        complexity: "complex",
        sourceExcerpt: "Its B form has a major and minor groove.",
      },
    ],
    source,
  );
  assert.equal(card.complexity, "complex");
  assert.equal(card.part, 0);
});

test("flashcards reject context-dependent fronts and cosmetic duplicates", () => {
  const clue = {
    clue: "Name the double-helix molecule.",
    part: 0,
    complexity: "simple",
    sourceExcerpt: "double helix",
  };
  for (const front of [
    "Name it",
    "What molecule is in the above passage?",
    "Identify this clue's subject.",
  ])
    assert.throws(() =>
      cache.validateClues([{ ...clue, clue: front }], question),
    );
  assert.throws(() =>
    cache.validateClues(
      [clue, { ...clue, clue: "NAME THE DOUBLE HELIX MOLECULE!" }],
      question,
    ),
  );
});

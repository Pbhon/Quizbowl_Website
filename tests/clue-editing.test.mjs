import test from "node:test";
import assert from "node:assert/strict";
import { loadBackend } from "./helpers/backend.mjs";
import { memoryFirestore } from "./helpers/memory-firestore.mjs";
const decks = loadBackend("src/lib/server/decks.ts", {
  "./site-team": { siteTeam: () => ({ id: "school" }) },
  "firebase-admin/firestore": {
    FieldValue: { serverTimestamp: () => "stamp" },
  },
});
const question = {
  parts: ["This molecule has a double helix."],
  answerLines: ["DNA [accept full name]"],
};
const clue = {
  id: "clue",
  clue: "Name the double-helix molecule.",
  complexity: "simple",
  part: 0,
  sourceExcerpt: "double helix",
};
function fixture() {
  return memoryFirestore(
    {
      "users/owner/decks/deck": { name: "Deck" },
      "users/owner/decks/deck/questions/card": {
        question,
        originalQuestion: question,
        identifiers: [clue],
      },
      "aiClueCache/shared": { identifiers: [clue] },
    },
    true,
  );
}
const edit = {
  action: "editIdentifier",
  deckId: "deck",
  cardId: "card",
  clueId: "clue",
  expectedClue: clue.clue,
  expectedComplexity: clue.complexity,
  clue: "Which molecule forms a double helix?",
  complexity: "intermediate",
  answer: "forged",
  sourceExcerpt: "forged",
  part: 99,
};
test("editing changes only owned clue front and complexity; stable ID, evidence and cache survive", async () => {
  const db = fixture();
  await decks.mutateDeck(db, "owner", edit, true);
  const saved = db.records.get("users/owner/decks/deck/questions/card");
  assert.equal(saved.identifiers[0].id, clue.id);
  assert.equal(saved.identifiers[0].part, 0);
  assert.equal(saved.identifiers[0].sourceExcerpt, clue.sourceExcerpt);
  assert.equal(saved.identifiers[0].clue, edit.clue);
  assert.deepEqual(saved.originalQuestion, question);
  assert.equal(
    db.records.get("aiClueCache/shared").identifiers[0].clue,
    clue.clue,
  );
  await assert.rejects(decks.mutateDeck(db, "owner", edit, true), {
    status: 409,
  });
  await assert.rejects(decks.mutateDeck(db, "other", edit, true), {
    status: 404,
  });
});

test("removing inaccurate clues keeps source and shared cache and detects stale edits", async () => {
  const db = fixture();
  await assert.rejects(
    decks.mutateDeck(
      db,
      "owner",
      { ...edit, action: "removeIdentifier", expectedClue: "stale" },
      true,
    ),
    { status: 409 },
  );
  await decks.mutateDeck(
    db,
    "owner",
    { ...edit, action: "removeIdentifier" },
    true,
  );
  const saved = db.records.get("users/owner/decks/deck/questions/card");
  assert.equal(saved.identifiers.length, 0);
  assert.deepEqual(saved.originalQuestion, question);
  assert.equal(db.records.get("aiClueCache/shared").identifiers.length, 1);
});

test("clue edits and removals enforce current teacher creator permissions", async () => {
  for (const action of ["editIdentifier", "removeIdentifier"]) {
    const db = fixture();
    db.records.set("users/owner/decks/deck", {
      name: "Teacher deck",
      curatedBy: "owner",
    });
    await assert.rejects(
      decks.mutateDeck(db, "owner", { ...edit, action }, true),
      { status: 403 },
    );
    assert.equal(
      db.records.get("users/owner/decks/deck/questions/card").identifiers
        .length,
      1,
    );
  }
});

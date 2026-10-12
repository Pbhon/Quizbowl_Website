import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const compiledModule = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(readFileSync("src/lib/anki-export.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  {
    module: compiledModule,
    exports: compiledModule.exports,
    TextEncoder,
    require: (id) => {
      if (id !== "./decks") return require(id);
      const decksModule = { exports: {} };
      vm.runInNewContext(
        ts.transpileModule(readFileSync("src/lib/decks.ts", "utf8"), {
          compilerOptions: { module: ts.ModuleKind.CommonJS },
        }).outputText,
        { module: decksModule, exports: decksModule.exports },
      );
      return decksModule.exports;
    },
  },
);
const { ankiCSV, exportRows } = compiledModule.exports;
test("note IDs survive deck copies, filters and edits; different questions and clues stay distinct", () => {
  const first = exportRows(deck)[0].noteId;
  const copy = {
    ...deck,
    id: "different",
    name: "renamed",
    cards: [
      {
        ...deck.cards[0],
        id: "copied",
        question: { ...question, parts: ["edited"] },
      },
    ],
  };
  assert.equal(exportRows(copy, { difficulty: "0" })[0].noteId, first);
  assert.notEqual(
    exportRows({
      ...deck,
      cards: [
        { ...deck.cards[0], originalQuestion: { ...question, id: "other" } },
      ],
    })[0].noteId,
    first,
  );
  const clue = {
    id: "clue-1",
    clue: "Original",
    part: 0,
    sourceExcerpt: "excerpt",
    complexity: "simple",
  };
  const generated = (identifiers) =>
    exportRows(
      { ...deck, cards: [{ ...deck.cards[0], identifiers }] },
      { kind: "identifiers" },
    );
  assert.equal(
    generated([clue])[0].noteId,
    generated([
      {
        ...clue,
        clue: "edited",
        complexity: "complex",
        sourceExcerpt: "edited excerpt",
      },
    ])[0].noteId,
  );
  assert.notEqual(
    generated([clue])[0].noteId,
    generated([{ ...clue, id: "clue-2" }])[0].noteId,
  );
  const legacy = { ...clue, id: undefined };
  assert.equal(
    generated([legacy])[0].noteId,
    generated([{ ...legacy, clue: "edited" }])[0].noteId,
  );
  const duplicates = exportRows({
    ...deck,
    cards: [deck.cards[0], { ...deck.cards[0], tags: ["second"] }],
  });
  assert.equal(duplicates.length, 1);
  assert.ok(duplicates[0].tags.includes("topic::second"));
});
test("formatting keeps emphasis and line breaks while escaping active markup and edited text", () => {
  const formatted = {
    ...question,
    formattedParts: [
      '<b onclick="alert(1)">Cell</b><img src=x onerror=alert(1)>\nNext',
    ],
  };
  const rows = exportRows({
    ...deck,
    cards: [{ ...deck.cards[0], originalQuestion: formatted }],
  });
  assert.ok(rows[0].front.includes("<b>Cell</b>"));
  assert.ok(!rows[0].front.includes("<img"));
  assert.ok(!rows[0].front.includes("<b onclick"));
  assert.ok(rows[0].front.includes("<br>Next"));
  const edited = exportRows({
    ...deck,
    cards: [
      {
        ...deck.cards[0],
        question: { ...question, parts: ["x < y & z\nnext"] },
      },
    ],
  });
  assert.equal(edited[0].front, "x &lt; y &amp; z<br>next");
});
const question = {
  id: "q",
  type: "tossup",
  category: "Science",
  subcategory: "Biology",
  difficulty: 0,
  source: "Tournament · Packet 1",
  leadin: "",
  parts: ['Name this cell, called a "neuron".\n日本語'],
  answers: ["<b>neuron</b> [accept nerve cell]"],
  answerLines: ["neuron [accept nerve cell]"],
};
const deck = {
  name: "Cells",
  tags: ["cell biology"],
  cards: [
    {
      id: "q",
      question,
      originalQuestion: question,
      tags: ["neurons"],
      notes: "",
    },
  ],
};
test("CSV escapes delimiters, quotes, newlines and keeps Unicode with Anki headers", () => {
  const csv = ankiCSV([
    { noteId: "id", front: 'a,"b"\nc', back: "日本語", tags: "" },
  ]);
  assert.ok(csv.startsWith("#separator:Comma\r\n#html:true\r\n"));
  assert.ok(csv.includes('"id","a,""b""\nc","日本語",""\r\n'));
  assert.equal(ankiCSV([]).split("\r\n").length, 6);
});
test("identifiers export separately with source excerpts and original part answers", () => {
  assert.equal(exportRows(deck, { kind: "identifiers" }).length, 0);
  const generated = {
    ...deck,
    cards: [
      {
        ...deck.cards[0],
        identifiers: [
          {
            clue: "Which cell carries impulses?",
            complexity: "simple",
            part: 0,
            sourceExcerpt: "called a neuron",
          },
          {
            clue: "Invalid",
            complexity: "complex",
            part: 8,
            sourceExcerpt: "x",
          },
        ],
      },
    ],
  };
  const rows = exportRows(generated, { kind: "identifiers" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].front, "Which cell carries impulses?");
  assert.ok(rows[0].back.includes("<b>neuron</b> [accept nerve cell]"));
  assert.ok(rows[0].back.includes("called a neuron"));
  assert.equal(
    exportRows(generated, { kind: "identifiers", complexity: "complex" })
      .length,
    0,
  );
  assert.equal(
    exportRows(generated, {
      kind: "identifiers",
      complexity: "simple",
      difficulty: "0",
    }).length,
    1,
  );
});
test("full question rows retain the whole question and original official answer", () => {
  const edited = {
    ...deck,
    cards: [
      { ...deck.cards[0], question: { ...question, answerLines: ["edited"] } },
    ],
  };
  const rows = exportRows(edited);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].back.includes("<b>neuron</b> [accept nerve cell]"));
});
test("category and difficulty filters include difficulty zero and combine", () => {
  assert.equal(
    exportRows(deck, { category: "Science", difficulty: "0" }).length,
    1,
  );
  assert.equal(exportRows(deck, { category: "History" }).length, 0);
  assert.equal(exportRows(deck, { difficulty: "1" }).length, 0);
});
test("exports category, subcategory and deck/card topics as whitespace-safe tags", () => {
  const tags = exportRows(deck)[0].tags;
  assert.ok(tags.includes("category::Science"));
  assert.ok(tags.includes("subcategory::Biology"));
  assert.ok(tags.includes("topic::cell%20biology"));
  assert.ok(tags.includes("topic::neurons"));
  assert.ok(tags.includes("difficulty::0"));
});
test("includes available tournament/packet source and handles missing source", () => {
  assert.ok(exportRows(deck)[0].back.includes("Source: Tournament · Packet 1"));
  const missing = {
    ...deck,
    cards: [
      { ...deck.cards[0], originalQuestion: { ...question, source: "" } },
    ],
  };
  assert.ok(!exportRows(missing)[0].back.includes("Source:"));
});

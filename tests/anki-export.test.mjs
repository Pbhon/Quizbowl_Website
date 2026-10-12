import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
const module = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(readFileSync("src/lib/anki-export.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  {
    module,
    exports: module.exports,
    require: () => {
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
const { ankiCSV, exportRows } = module.exports;
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
  const csv = ankiCSV([{ front: 'a,"b"\nc', back: "日本語", tags: "" }]);
  assert.ok(csv.startsWith("#separator:Comma\r\n#html:true\r\n"));
  assert.ok(csv.includes('"a,""b""\nc","日本語",""\r\n'));
  assert.equal(ankiCSV([]).split("\r\n").length, 5);
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

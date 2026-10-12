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
  { module, exports: module.exports },
);
const { ankiCSV, exportRows } = module.exports;
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
test("full question rows retain the whole question and original official answer", () => {
  const edited = {
    ...deck,
    cards: [
      { ...deck.cards[0], question: { ...question, answerLines: ["edited"] } },
    ],
  };
  const rows = exportRows(edited);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].back.includes("neuron [accept nerve cell]"));
});

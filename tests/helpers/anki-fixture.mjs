import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
export function loadTS(path, imports = {}, globals = {}) {
  const compiledModule = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module: compiledModule,
      exports: compiledModule.exports,
      require: (id) => (id in imports ? imports[id] : require(id)),
      TextEncoder,
      Uint8Array,
      Buffer,
      ...globals,
    },
  );
  return compiledModule.exports;
}
export const decks = loadTS("src/lib/decks.ts");
export const exporter = loadTS("src/lib/anki-export.ts", { "./decks": decks });
export const packageClock = { now: () => Date.now() };
export const packager = loadTS(
  "src/lib/server/anki-package.ts",
  { "server-only": {}, "@/lib/anki-export": exporter },
  {
    Date: class extends Date {
      static now() {
        return packageClock.now();
      }
    },
  },
);
const tossup = {
  id: "anki-tossup",
  type: "tossup",
  category: "Science",
  subcategory: "Biology",
  difficulty: 0,
  source: "Tournament · Packet 1",
  leadin: "",
  parts: ['Name this "cell", in 日本語.\nSecond line: x < y & z.'],
  formattedParts: [
    'Name this <i>"cell"</i>, in 日本語.<br>Second line: x &lt; y &amp; z.',
  ],
  answers: ["<b>neuron</b> [accept nerve cell]"],
  answerLines: ["neuron [accept nerve cell]"],
};
const bonus = {
  ...tossup,
  id: "anki-bonus",
  type: "bonus",
  difficulty: 4,
  leadin: "Answer these cell questions.",
  formattedLeadin: "Answer these <b>cell</b> questions.",
  parts: ["First organelle?", "Second organelle?"],
  formattedParts: ["<i>First</i> organelle?", "Second organelle?"],
  answers: ["<b>mitochondria</b>", "<b>chloroplast</b>"],
  answerLines: ["mitochondria", "chloroplast"],
};
export const fixtureDeck = {
  id: "fixture",
  name: "Anki checks",
  canEdit: true,
  sharedId: null,
  visibility: "private",
  teamName: "",
  description: "",
  tags: ["cell biology"],
  questions: [tossup, bonus],
  cards: [tossup, bonus].map((question) => ({
    id: question.id,
    question,
    originalQuestion: question,
    tags: ["cells"],
    notes: "",
    identifiers: [
      {
        id: `${question.id}-clue`,
        clue: "Which cell or organelle is this?",
        complexity: "simple",
        part: 0,
        sourceExcerpt: question.parts[0],
      },
    ],
  })),
};

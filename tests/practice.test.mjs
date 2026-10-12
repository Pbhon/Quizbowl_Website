import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

// Execute the real TypeScript route handlers with only the upstream HTTP call replaced.
function load(path, upstream) {
  const compiledModule = { exports: {} };
  const code = ts.transpileModule(
    readFileSync(new URL(`../src/${path}.ts`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    module: compiledModule,
    exports: compiledModule.exports,
    require: (id) =>
      id === "@/lib/practice"
        ? load("lib/practice", upstream)
        : id === "@/lib/server/qbreader"
          ? { qbreader: upstream }
          : id === "@/lib/server/history"
            ? {
                historyQuestion: async () => {
                  throw new Error("Unexpected history retry");
                },
              }
            : id === "@/lib/server/practice-persistence"
              ? {
                  authenticatePractice: async () => null,
                  PracticeError: class extends Error {},
                }
              : (() => {
                  throw new Error(`Unexpected import: ${id}`);
                })(),
    Response,
    URLSearchParams,
    Set,
  });
  return compiledModule.exports;
}
const raw = (id) => ({
  _id: id,
  category: "Science",
  subcategory: "Biology",
  difficulty: 0,
  question: "<i>Clue</i>",
  question_sanitized: "Clue",
  answer: "<b><u>DNA</u></b> [accept deoxyribonucleic acid]",
  answer_sanitized: "DNA [accept deoxyribonucleic acid]",
  set: { name: "Test set" },
  packet: { name: "Packet 1" },
});
const filters = {
  type: "tossup",
  count: 2,
  difficulty: 0,
  category: "Science",
  subcategory: "Biology",
  topic: "",
  excluded: [],
};
const request = (body) =>
  new Request("http://localhost/api/practice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("random fetching forwards difficulty zero and filters, excludes history and duplicates", async () => {
  const { POST } = load(
    "app/api/practice/questions/route",
    async (endpoint, params) => {
      assert.equal(endpoint, "random-tossup");
      assert.equal(params.get("difficulties"), "0");
      assert.equal(params.get("categories"), "Science");
      assert.equal(params.get("subcategories"), "Biology");
      return { tossups: [raw("old"), raw("new"), raw("new"), raw("another")] };
    },
  );
  const response = await POST(request({ ...filters, excluded: ["old"] }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(
    data.questions.map((q) => q.id),
    ["new", "another"],
  );
  assert.match(data.questions[0].answers[0], /<b><u>/);
  assert.equal(data.questions[0].answerLines[0], raw("new").answer_sanitized);
});

test("topic search advances pages when the first page is already answered", async () => {
  const calls = [];
  const { POST } = load(
    "app/api/practice/questions/route",
    async (endpoint, params) => {
      calls.push(params.get("tossupPagination"));
      assert.equal(endpoint, "query");
      assert.equal(params.get("q"), "DNA");
      assert.equal(params.get("questionType"), "tossup");
      return {
        tossups: {
          questionArray:
            calls.length === 1
              ? Array.from({ length: 100 }, () => raw("old"))
              : [raw("new")],
        },
      };
    },
  );
  const response = await POST(
    request({ ...filters, count: 1, topic: "DNA", excluded: ["old"] }),
  );
  assert.deepEqual(calls, ["1", "2"]);
  assert.equal((await response.json()).questions[0].id, "new");
});

test("malformed bonuses are excluded while all valid parts are retained", async () => {
  const good = {
    ...raw("bonus"),
    leadin_sanitized: "Lead in",
    parts_sanitized: ["Part one", "Part two"],
    answers: ["DNA", "RNA"],
    answers_sanitized: ["DNA", "RNA"],
  };
  const { POST } = load("app/api/practice/questions/route", async () => ({
    bonuses: [{ ...good, _id: "bad", answers: ["DNA"] }, good],
  }));
  const response = await POST(request({ ...filters, type: "bonus" }));
  const { questions } = await response.json();
  assert.equal(questions.length, 1);
  assert.equal(questions[0].parts.length, 2);
});

test("narrow exhausted pools stop rather than repeatedly fetching", async () => {
  let calls = 0;
  const { POST } = load("app/api/practice/questions/route", async () => {
    calls++;
    return { tossups: [raw("old")] };
  });
  assert.deepEqual(
    (await (await POST(request({ ...filters, excluded: ["old"] }))).json())
      .questions,
    [],
  );
  assert.equal(calls, 1);
});

test("invalid filters never contact QBReader", async () => {
  const { POST } = load("app/api/practice/questions/route", async () => {
    throw new Error("Should not call upstream");
  });
  for (const changes of [
    { count: 51 },
    { difficulty: 11 },
    { category: "Science", subcategory: "World History" },
    { topic: "x".repeat(201) },
    { excluded: [7] },
  ])
    assert.equal((await POST(request({ ...filters, ...changes }))).status, 400);
});

test("answer checking preserves directed prompts and rejects malformed verdicts", async () => {
  for (const directive of ["accept", "reject", "prompt"]) {
    const { POST } = load(
      "app/api/practice/check-answer/route",
      async (endpoint, params) => {
        assert.equal(endpoint, "check-answer");
        assert.equal(params.get("givenAnswer"), "DNA");
        assert.match(params.get("answerline"), /<u>/);
        return { directive, directedPrompt: "Which molecule?" };
      },
    );
    const response = await POST(
      request({ answerline: raw("q").answer, givenAnswer: " DNA " }),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).directive, directive);
  }
  const { POST } = load("app/api/practice/check-answer/route", async () => ({
    directive: "unknown",
  }));
  assert.equal(
    (await POST(request({ answerline: "DNA", givenAnswer: "DNA" }))).status,
    502,
  );
});

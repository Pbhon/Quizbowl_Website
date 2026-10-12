import { test, expect, type Page } from "@playwright/test";

const tossup = (id: string) => ({
  id,
  type: "tossup",
  category: "Science",
  subcategory: "Biology",
  difficulty: 4,
  source: "Test set · Packet 1",
  leadin: "",
  parts: ["This is the first clue. Another clue identifies a cell organelle."],
  answers: ["<b><u>mitochondria</u></b> [accept mitochondrion]"],
  answerLines: ["mitochondria [accept mitochondrion]"],
});
const bonus = {
  ...tossup("bonus-1"),
  type: "bonus",
  leadin: "Answer these questions about biology.",
  parts: [
    "Name the powerhouse.",
    "Name the genetic material.",
    "Name the protein factory.",
  ],
  answers: ["mitochondria", "DNA", "ribosome"],
  answerLines: [
    "mitochondria",
    "DNA [accept deoxyribonucleic acid]",
    "ribosome",
  ],
};

async function mockQuestions(page: Page, questions: unknown[]) {
  await page.route("**/api/practice/questions", (route) =>
    route.fulfill({ json: { questions } }),
  );
}

test("tossup reading, buzzing, clarification and summary", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockQuestions(page, [tossup("t1")]);
  const submissions: Record<string, string>[] = [];
  await page.route("**/api/practice/check-answer", (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({
      json:
        submissions.length === 1
          ? { directive: "prompt", directedPrompt: "Which organelle?" }
          : { directive: "accept" },
    });
  });
  await page.goto("/practice");
  await page.getByLabel("Number of questions").fill("1");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(
    page.getByRole("button", { name: "Buzz", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(page.getByTestId("question-text")).toContainText("This");
  await page.getByRole("button", { name: "Buzz", exact: true }).click();
  const frozen = await page.getByTestId("question-text").textContent();
  await page.getByLabel("Your answer", { exact: true }).fill("organelle");
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(page.getByText("Which organelle?")).toBeVisible();
  await expect(page.getByTestId("question-text")).toHaveText(frozen!);
  await page.getByLabel("Clarify your answer").fill("mitochondrion");
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(
    page.getByText("mitochondria [accept mitochondrion]", { exact: true }),
  ).toBeVisible();
  expect(submissions[0].answerline).toContain("<b><u>");
  await page.screenshot({
    path: info.outputPath("practice-reader.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "View summary" }).click();
  await expect(
    page.getByRole("heading", { name: "Session summary" }),
  ).toBeVisible();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("bonus parts count correct, incorrect and skipped independently", async ({
  page,
}) => {
  await mockQuestions(page, [bonus]);
  await page.route("**/api/practice/check-answer", (route) =>
    route.fulfill({
      json: {
        directive:
          route.request().postDataJSON().givenAnswer === "mitochondria"
            ? "accept"
            : "reject",
      },
    }),
  );
  await page.goto("/practice");
  await page.getByLabel("Question type").selectOption("bonus");
  await page.getByLabel("Number of questions").fill("1");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByText(bonus.leadin)).toBeVisible();
  await page.getByLabel("Your answer", { exact: true }).fill("mitochondria");
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.getByRole("button", { name: "Next part" }).click();
  await page.getByLabel("Your answer", { exact: true }).fill("RNA");
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(
    page.getByText("DNA [accept deoxyribonucleic acid]", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next part" }).click();
  await page.getByRole("button", { name: "Skip and reveal answer" }).click();
  await expect(
    page.getByText("Correct: 1 · Incorrect: 1 · Skipped: 1"),
  ).toBeVisible();
  await page.getByRole("button", { name: "View summary" }).click();
  await expect(page.getByText("50%", { exact: true })).toBeVisible();
  await expect(
    page.getByText("1 bonuses completed · 3 bonus parts"),
  ).toBeVisible();
});

test("filters and persisted answered IDs are sent accurately", async ({
  page,
}) => {
  await page.goto("/practice");
  await page.evaluate(() =>
    localStorage.setItem(
      "quizbowl:answered:v1:guest",
      JSON.stringify(["already-answered"]),
    ),
  );
  let body: Record<string, unknown> = {};
  await page.route("**/api/practice/questions", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ json: { questions: [] } });
  });
  await page.getByLabel("Difficulty", { exact: true }).selectOption("0");
  await page.getByLabel("Category", { exact: true }).selectOption("Science");
  await page.getByLabel("Subcategory", { exact: true }).selectOption("Biology");
  await page.getByLabel("Specific topic").fill("photosynthesis");
  await page.getByLabel("Number of questions").fill("7");
  await page.getByLabel("Avoid previously answered questions").check();
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "No new questions",
  );
  expect(body).toEqual({
    type: "tossup",
    count: 7,
    difficulty: 0,
    category: "Science",
    subcategory: "Biology",
    topic: "photosynthesis",
    excluded: ["already-answered"],
  });
  await page.getByLabel("Category", { exact: true }).selectOption("History");
  await expect(page.getByLabel("Subcategory", { exact: true })).toHaveValue("");
});

test("answer checking failure preserves response and supports retry", async ({
  page,
}) => {
  await mockQuestions(page, [bonus]);
  let calls = 0;
  await page.route("**/api/practice/check-answer", (route) =>
    route.fulfill(
      ++calls === 1
        ? {
            status: 502,
            json: { error: "QBReader is unavailable. Please retry." },
          }
        : { json: { directive: "reject" } },
    ),
  );
  await page.goto("/practice");
  await page.getByLabel("Question type").selectOption("bonus");
  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByLabel("Your answer", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "unavailable",
  );
  await expect(page.getByLabel("Your answer", { exact: true })).toHaveValue(
    "wrong",
  );
  await expect(
    page.getByText("Correct: 0 · Incorrect: 0 · Skipped: 0"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(
    page.getByText("Correct: 0 · Incorrect: 1 · Skipped: 0"),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("quizbowl:answered:v1:guest") || "[]"),
    ),
  ).toEqual(["bonus-1"]);
  await page.reload();
  await page.getByLabel("Avoid previously answered questions").check();
  const request = page.waitForRequest("**/api/practice/questions");
  await page.getByRole("button", { name: "Start session" }).click();
  expect((await request).postDataJSON().excluded).toEqual(["bonus-1"]);
});

test("skipped questions do not enter answered history", async ({ page }) => {
  await mockQuestions(page, [tossup("skipped")]);
  await page.goto("/practice");
  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("button", { name: "Skip and reveal answer" }).click();
  await page.getByRole("button", { name: "View summary" }).click();
  await expect(page.getByText("0%", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("quizbowl:answered:v1:guest"),
    ),
  ).toBeNull();
});

test("practice endpoints reject invalid input", async ({ request }) => {
  const questions = await request.post("/api/practice/questions", {
    data: {
      type: "tossup",
      count: 500,
      difficulty: "",
      category: "",
      subcategory: "",
      topic: "",
      excluded: [],
    },
  });
  expect(questions.status()).toBe(400);
  const answer = await request.post("/api/practice/check-answer", {
    data: { answerline: "mitochondria", givenAnswer: " " },
  });
  expect(answer.status()).toBe(400);
});

test("live QBReader routes fetch both types, filter topics and judge answers", async ({
  request,
}) => {
  test.skip(process.env.QBREADER_LIVE !== "true", "Opt-in live API smoke test");
  for (const type of ["tossup", "bonus"]) {
    const response = await request.post("/api/practice/questions", {
      data: {
        type,
        count: 1,
        difficulty: 4,
        category: "Science",
        subcategory: "Biology",
        topic: "",
        excluded: [],
      },
    });
    expect(response.status()).toBe(200);
    const { questions } = await response.json();
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      type,
      difficulty: 4,
      category: "Science",
      subcategory: "Biology",
    });
    expect(questions[0].parts.length).toBe(questions[0].answers.length);
    const excluded = await request.post("/api/practice/questions", {
      data: {
        type,
        count: 1,
        difficulty: 4,
        category: "Science",
        subcategory: "Biology",
        topic: "",
        excluded: [questions[0].id],
      },
    });
    expect(excluded.status()).toBe(200);
    expect(
      (await excluded.json()).questions.some(
        (q: { id: string }) => q.id === questions[0].id,
      ),
    ).toBe(false);
  }
  const topic = await request.post("/api/practice/questions", {
    data: {
      type: "tossup",
      count: 1,
      difficulty: "",
      category: "Science",
      subcategory: "Biology",
      topic: "photosynthesis",
      excluded: [],
    },
  });
  expect(topic.status()).toBe(200);
  const { questions } = await topic.json();
  expect(questions).toHaveLength(1);
  expect(
    (
      questions[0].parts.join(" ") + questions[0].answerLines.join(" ")
    ).toLowerCase(),
  ).toContain("photosynthesis");
  const check = await request.post("/api/practice/check-answer", {
    data: {
      answerline: "<b><u>mitochondria</u></b> [accept mitochondrion]",
      givenAnswer: "mitochondrion",
    },
  });
  expect(check.status()).toBe(200);
  expect((await check.json()).directive).toBe("accept");
});

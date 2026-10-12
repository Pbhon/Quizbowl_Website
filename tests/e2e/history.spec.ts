import { test, expect, type Page } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
const enabled = process.env.E2E_FIREBASE === "true";
if (enabled) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("quizbowl-test-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("You’re signed in", { exact: true }),
  ).toBeVisible();
}
test("history APIs and page require sign-in", async ({ page, request }) => {
  await page.goto("/history");
  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toBeVisible();
  for (const url of ["/api/history?uid=someone-else", "/api/decks"]) {
    const response = await request.get(url);
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});
test("history pagination, filters, original question retries, decks, and account isolation", async ({
  page,
}, info) => {
  test.skip(!enabled, "Requires Firebase emulators");
  const app =
    getApps().find((a) => a.name === "history-tests") ||
    initializeApp({ projectId: "demo-quizbowl" }, "history-tests");
  const auth = getAuth(app),
    db = getFirestore(app);
  const alice = await auth.createUser({
    email: `history-${crypto.randomUUID()}@example.com`,
    password: "quizbowl-test-123",
  });
  const bob = await auth.createUser({
    email: `history-${crypto.randomUUID()}@example.com`,
    password: "quizbowl-test-123",
  });
  const question = {
    id: "original-bonus",
    type: "bonus",
    category: "Science",
    subcategory: "Biology",
    difficulty: 0,
    source: "Original packet",
    leadin: "Answer these parts.",
    parts: ["Original first clue", "Original second clue"],
    answers: ["<b>mitochondria</b>", "<b>chloroplast</b>"],
    answerLines: ["mitochondria", "chloroplast"],
  };
  try {
    const batch = db.batch();
    for (let i = 0; i < 35; i++)
      batch.set(db.doc(`users/${alice.uid}/attempts/attempt-${i}`), {
        question: {
          ...question,
          category: i % 2 ? "History" : "Science",
          subcategory: i % 2 ? "World History" : "Biology",
          difficulty: i === 34 ? 0 : 4,
        },
        part: 0,
        submittedAnswer: `my answer ${i}`,
        outcome: i % 2 ? "correct" : "incorrect",
        createdAt: Timestamp.fromMillis(Date.now() - (35 - i) * 1000),
        submissions: [
          {
            answer: `my answer ${i}`,
            directive: i % 2 ? "accept" : "reject",
            directedPrompt: null,
            submittedAt: new Date().toISOString(),
          },
        ],
      });
    await batch.commit();
    await signIn(page, alice.email!);
    await page.goto("/history");
    const cards = page.locator('[data-slot="card"]');
    await expect(cards).toHaveCount(30);
    await expect(cards.first()).toContainText("my answer 34");
    await page.getByRole("button", { name: "Older attempts" }).click();
    await expect(cards).toHaveCount(5);
    await page.getByRole("button", { name: "Refresh latest attempts" }).click();
    await expect(cards).toHaveCount(30);
    await page.getByLabel("Subject", { exact: true }).selectOption("Science");
    await expect(cards).toHaveCount(18);
    await page.getByLabel("Difficulty", { exact: true }).selectOption("0");
    await expect(cards).toHaveCount(1);
    await page.getByLabel("Result", { exact: true }).selectOption("correct");
    await expect(
      page.getByText("No saved attempts match", { exact: false }),
    ).toBeVisible();
    await page.getByLabel("Result", { exact: true }).selectOption("incorrect");
    await expect(cards).toHaveCount(1);
    await page.getByText("View full question and response history").click();
    await expect(
      page.getByText("Original second clue", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add to deck" }).click();
    await page.getByLabel("New deck name").fill("Biology review");
    await page
      .getByRole("button", { name: "Save question", exact: true })
      .click();
    await expect(page.getByText("Question saved to your deck.")).toBeVisible();
    const savedDecks = await db.collection(`users/${alice.uid}/decks`).get();
    expect(savedDecks.size).toBe(2);
    const biologyDeck = savedDecks.docs.find(
      (doc) => doc.data().name === "Biology review",
    )!;
    const savedCards = await biologyDeck.ref.collection("questions").get();
    expect(savedCards.docs[0].data().question).toEqual(question);
    await page.getByRole("button", { name: "Add to deck" }).click();
    await page
      .getByRole("checkbox", { name: "Biology review", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Save question", exact: true })
      .click();
    await expect(page.getByText("Question saved to your deck.")).toBeVisible();
    await page.screenshot({
      path: info.outputPath("history.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("link", { name: "Retry missed question", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Retry missed question", exact: true })
      .click();
    await expect(
      page.getByText("Original first clue", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Skip and reveal answer", exact: true })
      .click();
    await expect(
      page.getByText("Official answer line", { exact: false }),
    ).toBeVisible();
    expect(
      (await db.collection(`users/${alice.uid}/attempts`).get()).size,
    ).toBe(36);
    await page.goto("/decks");
    await expect(
      page.getByRole("heading", { name: "Biology review" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await signIn(page, bob.email!);
    await page.goto("/history");
    await expect(
      page.getByText("No saved attempts match", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("my answer 34", { exact: false })).toHaveCount(
      0,
    );
    await page.goto("/practice?retryAttemptId=attempt-34");
    await page
      .getByRole("button", { name: "Retry missed question", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Question attempt not found" }),
    ).toContainText("Question attempt not found");
    await page.goto("/decks");
    await expect(
      page.getByRole("heading", { name: "Starred Questions", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Biology review" }),
    ).toHaveCount(0);
  } finally {
    await db.recursiveDelete(db.doc(`users/${alice.uid}`));
    await db.recursiveDelete(db.doc(`users/${bob.uid}`));
    await db.doc(`teams/team-e2e/members/${alice.uid}`).delete();
    await db.doc(`teams/team-e2e/members/${bob.uid}`).delete();
    await auth.deleteUser(alice.uid);
    await auth.deleteUser(bob.uid);
  }
});

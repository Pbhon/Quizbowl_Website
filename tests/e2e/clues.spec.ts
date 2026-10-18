import { test, expect } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

const enabled = process.env.E2E_FIREBASE === "true";
if (enabled) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}

test("saved clue lifecycle: cached generation, source reveal, editing, removal and confirmed regeneration", async ({
  page,
}, info) => {
  test.skip(!enabled, "Requires local demo Firebase emulators");
  const app =
    getApps().find((app) => app.name === "clue-browser") ||
    initializeApp({ projectId: "demo-quizbowl" }, "clue-browser");
  const auth = getAuth(app),
    db = getFirestore(app);
  const user = await auth.createUser({
    email: `clues-${crypto.randomUUID()}@example.com`,
    password: "clue-test-password-123",
    emailVerified: true,
  });
  const question = {
    id: crypto.randomUUID(),
    type: "tossup",
    leadin: "",
    parts: ["This molecule has a double helix."],
    answers: ["DNA"],
    answerLines: ["DNA [accept deoxyribonucleic acid]"],
    category: "Science",
    subcategory: "Biology",
    difficulty: 4,
    source: "Clue verification packet",
  };
  const clue = {
    clue: "Name the double-helix molecule.",
    part: 0,
    complexity: "simple",
    sourceExcerpt: "double helix",
  };
  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify([
        "clues-v6",
        "test-browser-model",
        question.type,
        question.id,
        question.leadin,
        question.parts,
        question.answers,
        question.answerLines,
      ]),
    )
    .digest("hex");
  const cache = db.doc(`aiClueCache/${cacheKey}`);
  const card = db.doc(`users/${user.uid}/decks/deck/questions/card`);
  let generationPosts = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/ai/clues") && request.method() === "POST")
      generationPosts++;
  });
  try {
    await db.doc(`users/${user.uid}/decks/deck`).set({
      name: "AI biology",
      visibility: "private",
      createdAt: new Date(),
    });
    await card.set({
      question,
      originalQuestion: question,
      generation: { status: "pending" },
    });
    await cache.set({
      status: "completed",
      revision: "revision-one",
      identifiers: [clue],
    });
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(user.email!);
    await page
      .getByLabel("Password", { exact: true })
      .fill("clue-test-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByText("You’re signed in", { exact: true }),
    ).toBeVisible();
    await page.goto("/decks");
    const deck = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("heading", { name: "AI biology", exact: true }),
    });
    await deck.locator("summary").filter({ hasText: "AI biology" }).click();
    await deck.locator("summary").filter({ hasText: "Difficulty 4" }).click();
    const panel = deck.getByRole("region", {
      name: "AI identifier flashcards",
    });
    await expect(panel.getByText(/Generation status: pending/)).toBeVisible();
    await expect(
      panel.getByText(/AI generations today: 0 \/ 20 used · 20 remaining/),
    ).toBeVisible();
    expect(generationPosts).toBe(0);
    await panel
      .getByRole("button", { name: "Generate AI clues", exact: true })
      .click();
    await expect(panel.getByText(clue.clue, { exact: true })).toBeVisible();
    await panel.getByText("Reveal official answer", { exact: true }).click();
    await expect(
      panel.getByText(question.answerLines[0], { exact: true }),
    ).toBeVisible();
    await panel.getByText("Verify source excerpt", { exact: true }).click();
    await expect(panel.getByRole("blockquote")).toHaveText(clue.sourceExcerpt);
    await panel
      .getByRole("button", { name: "Check generation status", exact: true })
      .click();
    await expect(
      panel.getByText(/AI generations today: 0 \/ 20 used · 20 remaining/),
    ).toBeVisible();
    expect(generationPosts).toBe(1);
    await panel.getByRole("button", { name: "Edit clue", exact: true }).click();
    await panel
      .getByLabel("Flashcard front", { exact: true })
      .fill("Which molecule forms a double helix?");
    await panel
      .getByLabel("Edited clue complexity", { exact: true })
      .selectOption("intermediate");
    await panel
      .getByRole("button", { name: "Save clue changes", exact: true })
      .click();
    await expect(
      panel
        .locator("article > p")
        .filter({ hasText: /^Which molecule forms a double helix\?$/ }),
    ).toBeVisible();
    await panel
      .getByLabel("Filter identifier complexity", { exact: true })
      .selectOption("simple");
    await expect(
      panel.getByText("Which molecule forms a double helix?", { exact: true }),
    ).toBeHidden();
    await panel
      .getByLabel("Filter identifier complexity", { exact: true })
      .selectOption("all");
    await panel
      .getByRole("button", { name: "Remove clue", exact: true })
      .click();
    expect((await card.get()).data()?.identifiers).toHaveLength(1);
    await panel
      .getByRole("button", { name: "Confirm remove clue", exact: true })
      .click();
    await expect(
      panel.getByText("Which molecule forms a double helix?", { exact: true }),
    ).toHaveCount(0);
    expect((await card.get()).data()?.identifiers).toHaveLength(0);
    expect((await cache.get()).data()?.identifiers[0].clue).toBe(clue.clue);
    // A newer shared result is reused by explicit regeneration, without any live provider configuration.
    await cache.set({
      status: "completed",
      revision: "revision-two",
      identifiers: [{ ...clue, clue: "What molecule has a double helix?" }],
    });
    await panel
      .getByRole("button", { name: "Regenerate AI clues", exact: true })
      .click();
    expect(generationPosts).toBe(1);
    await panel
      .getByRole("button", { name: "Confirm regenerate clues", exact: true })
      .click();
    await expect(
      panel.getByText("What molecule has a double helix?", { exact: true }),
    ).toBeVisible();
    expect(generationPosts).toBe(2);
    expect((await card.get()).data()?.originalQuestion.answerLines).toEqual(
      question.answerLines,
    );
    // Fresh generation is disabled in this test server; failure preserves existing cards.
    const quota = db.doc(
      `users/${user.uid}/aiUsage/${new Date().toISOString().slice(0, 10)}`,
    );
    await quota.set({ count: 20 });
    await panel
      .getByRole("button", { name: "Regenerate AI clues", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Confirm regenerate clues", exact: true })
      .click();
    await expect(
      panel.getByText("Clue generation is not configured.", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText(/AI generations today: 20 \/ 20 used · 0 remaining/),
    ).toBeVisible();
    await expect(panel.getByText(/Your daily limit is reached/)).toBeVisible();
    // Reload reads durable usage; it does not reset the allowance.
    await page.reload();
    await deck.locator("summary").filter({ hasText: "AI biology" }).click();
    await deck.locator("summary").filter({ hasText: "Difficulty 4" }).click();
    await expect(
      panel.getByText(/AI generations today: 20 \/ 20 used · 0 remaining/),
    ).toBeVisible();
    // Free cache delivery remains usable at the limit and refreshes the counter.
    await panel
      .getByRole("button", { name: "Use cached clues", exact: true })
      .click();
    await expect(
      panel.getByText("Generation status: completed", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText(/AI generations today: 20 \/ 20 used · 0 remaining/),
    ).toBeVisible();
    expect((await quota.get()).data()?.count).toBe(20);
    await quota.set({ count: 0 });
    await panel
      .getByRole("button", { name: "Refresh AI allowance", exact: true })
      .click();
    await expect(
      panel.getByText(/AI generations today: 0 \/ 20 used · 20 remaining/),
    ).toBeVisible();
    await expect(
      panel.getByText("What molecule has a double helix?", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("clue-review.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await db.recursiveDelete(db.doc(`users/${user.uid}`));
    await db.doc(`teams/team-e2e/members/${user.uid}`).delete();
    await cache.delete();
    await auth.deleteUser(user.uid);
  }
});

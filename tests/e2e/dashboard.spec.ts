import { test, expect, type Page } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
const enabled = process.env.E2E_FIREBASE === "true";
if (enabled) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}
function services() {
  const app =
    getApps().find((a) => a.name === "dashboard-tests") ||
    initializeApp({ projectId: "demo-quizbowl" }, "dashboard-tests");
  return { auth: getAuth(app), db: getFirestore(app) };
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
test("dashboard and API require authentication", async ({ page, request }) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toBeVisible();
  const response = await request.get("/api/dashboard?uid=another-student");
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toContain("no-store");
});
test("personal dashboard charts, upcoming records, retry, recommendations, and account switching", async ({
  page,
}) => {
  test.skip(!enabled, "Requires Firebase emulators");
  const { auth, db } = services();
  const alice = await auth.createUser({
    email: `dashboard-${crypto.randomUUID()}@example.com`,
    password: "quizbowl-test-123",
  });
  const bob = await auth.createUser({
    email: `dashboard-${crypto.randomUUID()}@example.com`,
    password: "quizbowl-test-123",
  });
  const assignmentId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const tomorrow = Timestamp.fromMillis(Date.now() + 86400000);
  try {
    await db.doc(`teams/team-e2e/assignments/${assignmentId}`).set({
      title: "Alice practice assignment",
      dueAt: tomorrow,
      studentUids: [alice.uid],
      published: true,
    });
    await db.doc(`teams/team-e2e/events/${eventId}`).set({
      title: "School competition",
      startsAt: tomorrow,
      audience: "team",
      type: "competition",
      published: true,
    });
    const batch = db.batch();
    for (let i = 0; i < 3; i++)
      batch.set(db.doc(`users/${alice.uid}/attempts/part-${i}`), {
        sessionId: "session",
        questionIndex: 0,
        part: i,
        outcome: i === 0 ? "correct" : "incorrect",
        question: {
          category: "Science",
          subcategory: "Biology",
          difficulty: 4,
        },
        completedAt: Timestamp.now(),
      });
    batch.set(db.doc(`users/${alice.uid}/practiceSessions/session`), {
      createdAt: Timestamp.now(),
      questionCount: 1,
      totalParts: 3,
      attemptedParts: 3,
      correct: 1,
      incorrect: 2,
      skipped: 0,
      completedAt: Timestamp.now(),
    });
    await batch.commit();
    await signIn(page, alice.email!);
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "Your dashboard" }),
    ).toBeVisible();
    await expect(
      page.getByText("Overall accuracy").locator(".."),
    ).toContainText("33.3%");
    await expect(
      page
        .locator("p")
        .filter({ hasText: /^Questions attempted$/ })
        .locator(".."),
    ).toContainText("1");
    await expect(page.getByText("Alice practice assignment")).toBeVisible();
    await expect(page.getByText("School competition")).toBeVisible();
    await page.getByLabel("Time period").selectOption("weekly");
    await expect(
      page
        .getByRole("group", { name: "Practice progress chart" })
        .getByRole("button"),
    ).toHaveCount(12);
    await page.getByLabel("Chart metric").selectOption("accuracy");
    await page
      .getByRole("group", { name: "Practice progress chart" })
      .getByRole("button")
      .last()
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "questions ·" }),
    ).toContainText("33.3%");
    await page.screenshot({
      path: `test-results/dashboard-${test.info().project.name}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
    await page.getByRole("link", { name: "Practice this subject" }).click();
    await expect(page.getByLabel("Category", { exact: true })).toHaveValue(
      "Science",
    );
    await expect(page.getByLabel("Subcategory", { exact: true })).toHaveValue(
      "Biology",
    );
    await page.goto("/dashboard");
    await expect(
      page.getByRole("button", { name: "Refresh statistics" }),
    ).toBeVisible();
    await page.route("**/api/dashboard?*", (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Statistics temporarily unavailable" },
      }),
    );
    await page.getByRole("button", { name: "Refresh statistics" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Statistics temporarily unavailable",
    );
    await page.unroute("**/api/dashboard?*");
    await page
      .getByRole("button", { name: "Retry loading statistics" })
      .click();
    await expect(
      page.getByText("Overall accuracy").locator(".."),
    ).toContainText("33.3%");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Sign in to continue" }),
    ).toBeVisible();
    await signIn(page, bob.email!);
    await page.goto("/dashboard");
    await expect(
      page.getByText("Overall accuracy").locator(".."),
    ).toContainText("—");
    await expect(page.getByText("Alice practice assignment")).toHaveCount(0);
    await expect(page.getByText("School competition")).toBeVisible();
    await expect(
      page.getByText("No saved practice sessions yet."),
    ).toBeVisible();
  } finally {
    await db.recursiveDelete(db.doc(`users/${alice.uid}`));
    await db.recursiveDelete(db.doc(`users/${bob.uid}`));
    await db.doc(`teams/team-e2e/members/${alice.uid}`).delete();
    await db.doc(`teams/team-e2e/members/${bob.uid}`).delete();
    await db.doc(`teams/team-e2e/assignments/${assignmentId}`).delete();
    await db.doc(`teams/team-e2e/events/${eventId}`).delete();
    await auth.deleteUser(alice.uid);
    await auth.deleteUser(bob.uid);
  }
});

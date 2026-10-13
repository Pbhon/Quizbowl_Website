import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
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
    getApps().find((a) => a.name === "team-dashboard-tests") ||
    initializeApp({ projectId: "demo-quizbowl" }, "team-dashboard-tests");
  return { auth: getAuth(app), db: getFirestore(app) };
}
async function token(request: APIRequestContext, email: string) {
  const response = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
    { data: { email, password: "quizbowl-test-123", returnSecureToken: true } },
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()).idToken as string;
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
test("team dashboard and review routes require authentication and no-store", async ({
  page,
  request,
}) => {
  await page.goto("/team");
  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toBeVisible();
  for (const path of [
    "/api/team/dashboard",
    "/api/team/dashboard?format=csv&student=other",
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  expect(
    (await request.post("/api/decks/reviews", { data: {} })).status(),
  ).toBe(401);
});
test("team statistics deny students, unverified and other-school staff, and honor revocation", async ({
  request,
}) => {
  test.skip(!enabled, "Requires Firebase emulators");
  const { auth, db } = services();
  const users = [];
  try {
    for (const [role, verified, teamId, expected] of [
      ["student", true, "team-e2e", 403],
      ["teacher", false, "team-e2e", 403],
      ["teacher", true, "other-school", 403],
      ["teacher", true, "team-e2e", 200],
      ["admin", true, "team-e2e", 200],
    ] as const) {
      const user = await auth.createUser({
        email: `staff-api-${crypto.randomUUID()}@example.com`,
        password: "quizbowl-test-123",
        emailVerified: verified,
      });
      users.push(user);
      if (role !== "student")
        await db.doc(`staff/${user.uid}`).set({ role, teamId });
      const headers = {
        Authorization: `Bearer ${await token(request, user.email!)}`,
      };
      for (const format of ["", "?format=csv"])
        expect(
          (
            await request.get(`/api/team/dashboard${format}`, { headers })
          ).status(),
        ).toBe(expected);
      if (expected === 200) {
        expect(
          (
            await request.get("/api/team/dashboard?timeZone=invalid", {
              headers,
            })
          ).status(),
        ).toBe(400);
        expect(
          (
            await request.get(
              "/api/team/dashboard?format=csv&student=outside",
              { headers },
            )
          ).status(),
        ).toBe(404);
        await db.doc(`staff/${user.uid}`).delete();
        expect(
          (await request.get("/api/team/dashboard", { headers })).status(),
        ).toBe(403);
      }
    }
  } finally {
    for (const user of users) {
      await db.doc(`staff/${user.uid}`).delete();
      await auth.deleteUser(user.uid);
    }
  }
});
test("full staff dashboard: totals, charts, heatmap, participation, assignments, reviews and CSV", async ({
  page,
  request,
}, info) => {
  test.skip(!enabled, "Requires Firebase emulators");
  const { auth, db } = services();
  const teacher = await auth.createUser({
    email: `team-teacher-${crypto.randomUUID()}@example.com`,
    password: "quizbowl-test-123",
    emailVerified: true,
    displayName: "Team Teacher",
  });
  const alice = await auth.createUser({
    email: `team-alice-${crypto.randomUUID()}@example.com`,
    password: "quizbowl-test-123",
    emailVerified: true,
    displayName: "Team Alice",
  });
  const bob = await auth.createUser({
    email: `team-bob-${crypto.randomUUID()}@example.com`,
    password: "quizbowl-test-123",
    emailVerified: true,
    displayName: "Team Bob",
  });
  const outsider = await auth.createUser({
    email: `team-outside-${crypto.randomUUID()}@example.com`,
    password: "quizbowl-test-123",
    emailVerified: true,
    displayName: "Private Outsider",
  });
  const assignmentId = crypto.randomUUID();
  try {
    await db
      .doc(`staff/${teacher.uid}`)
      .set({ role: "teacher", teamId: "team-e2e" });
    for (const user of [teacher, alice, bob])
      await db
        .doc(`teams/team-e2e/members/${user.uid}`)
        .set({ displayName: user.displayName });
    await db
      .doc(`teams/other/members/${outsider.uid}`)
      .set({ displayName: outsider.displayName });
    const question = {
      id: "team-q",
      type: "bonus",
      category: "Science",
      subcategory: "Biology",
      difficulty: 4,
      source: "Team fixture",
      leadin: "Biology",
      parts: [
        "Name the organelle.",
        "Name the other organelle.",
        "Name one more.",
      ],
      answers: ["mitochondria", "chloroplast", "nucleus"],
      answerLines: ["mitochondria", "chloroplast", "nucleus"],
    };
    for (let i = 0; i < 3; i++)
      await db.doc(`users/${alice.uid}/attempts/a${i}`).set({
        sessionId: "s",
        questionIndex: 0,
        part: i,
        outcome: i === 0 ? "correct" : "incorrect",
        question,
        completedAt: Timestamp.now(),
      });
    await db.doc(`users/${outsider.uid}/attempts/private`).set({
      sessionId: "private",
      questionIndex: 0,
      part: 0,
      outcome: "correct",
      question,
      completedAt: Timestamp.now(),
    });
    await db.doc(`teams/team-e2e/assignments/${assignmentId}`).set({
      title: "Biology assignment",
      published: true,
      studentUids: [alice.uid],
      questionCount: 5,
      dueAt: Timestamp.fromMillis(Date.now() + 86400000),
    });
    await db
      .doc(`teams/team-e2e/assignments/${assignmentId}/progress/${alice.uid}`)
      .set({ completedQuestions: 5 });
    await db.doc(`users/${alice.uid}/decks/biology`).set({
      name: "Review Biology",
      description: "",
      tags: [],
      visibility: "private",
      teamId: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await db
      .doc(`users/${alice.uid}/decks/biology/questions/c`)
      .set({ question, originalQuestion: question, tags: [], notes: "" });
    const studentHeaders = {
      Authorization: `Bearer ${await token(request, alice.email!)}`,
    };
    expect(
      (
        await request.get("/api/team/dashboard", { headers: studentHeaders })
      ).status(),
    ).toBe(403);
    await signIn(page, alice.email!);
    await page.goto("/decks");
    const deck = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("heading", { name: "Review Biology", exact: true }),
    });
    await deck.locator("summary").filter({ hasText: "Review Biology" }).click();
    await deck
      .getByRole("button", { name: "Study flashcards", exact: true })
      .click();
    await deck
      .getByRole("button", { name: "Flip to answer", exact: true })
      .click();
    await expect(
      deck.getByRole("button", { name: "Show question", exact: true }),
    ).toBeEnabled();
    expect(
      (await db.collection(`users/${alice.uid}/studyReviews`).get()).size,
    ).toBe(1);
    await deck
      .getByRole("button", { name: "Show question", exact: true })
      .click();
    await deck
      .getByRole("button", { name: "Flip to answer", exact: true })
      .click();
    expect(
      (await db.collection(`users/${alice.uid}/studyReviews`).get()).size,
    ).toBe(1);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await signIn(page, teacher.email!);
    await page.goto("/team");
    await expect(
      page.getByRole("heading", { name: "Teacher/Admin dashboard" }),
    ).toBeVisible();
    await expect(
      page.getByText("Questions attempted: 1", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Correct: 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Incorrect: 2", { exact: true })).toBeVisible();
    await expect(page.getByText("Private Outsider")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Subject by difficulty heatmap" }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", {
        name: "Subject accuracy across difficulties 0 to 10",
      }),
    ).toContainText("33.3%");
    await expect(
      page.getByRole("table", { name: "Assignment completion" }),
    ).toContainText("completed");
    await expect(
      page.getByRole("table", { name: "Deck and review activity" }),
    ).toContainText("Team Alice");
    await page
      .getByLabel("Time period", { exact: true })
      .selectOption("weekly");
    await expect(
      page
        .getByRole("group", { name: "Performance trend chart" })
        .getByRole("button"),
    ).toHaveCount(12);
    await page.getByLabel("Chart metric").selectOption("accuracy");
    await page
      .getByRole("group", { name: "Performance trend chart" })
      .getByRole("button")
      .last()
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "questions ·" }),
    ).toContainText("33.3%");
    await page.getByLabel("Participation filter").selectOption("never");
    await expect(
      page.getByRole("table", { name: "Student participation" }),
    ).toContainText("Team Bob");
    await expect(
      page.getByRole("table", { name: "Student participation" }),
    ).not.toContainText("Team Alice");
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", {
        name: "Export team statistics to CSV",
        exact: true,
      })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("quizbowl-team-statistics.csv");
    await page.getByLabel("Statistics for").selectOption(alice.uid);
    await expect(
      page.getByRole("button", { name: "Export individual statistics to CSV" }),
    ).toBeVisible();
    const headers = {
      Authorization: `Bearer ${await token(request, teacher.email!)}`,
    };
    const individual = await request.get(
      `/api/team/dashboard?format=csv&student=${alice.uid}`,
      { headers },
    );
    expect(await individual.text()).toContain('"Team Alice"');
    expect(await individual.text()).not.toContain('"Team Bob"');
    const data = await (
      await request.get("/api/team/dashboard", { headers })
    ).json();
    const student = data.students.find(
      (s: { uid: string }) => s.uid === alice.uid,
    );
    expect(student.study.reviews).toBe(1);
    expect(student.study.savedCards).toBe(1);
    expect(
      data.students.some((s: { uid: string }) => s.uid === outsider.uid),
    ).toBe(false);
    await page.screenshot({
      path: info.outputPath("team-dashboard.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
    // A failed refresh clears old student data and offers another retry.
    await page.route("**/api/team/dashboard?timeZone=*", (r) =>
      r.fulfill({
        status: 503,
        json: { error: "Temporary dashboard failure" },
      }),
    );
    await page.getByRole("button", { name: "Refresh team statistics" }).click();
    await expect(page.getByText("Temporary dashboard failure")).toBeVisible();
    await expect(
      page.getByText("Questions attempted: 1", { exact: true }),
    ).toHaveCount(0);
    await page.unroute("**/api/team/dashboard?timeZone=*");
    await page.getByRole("button", { name: "Refresh team statistics" }).click();
    await expect(
      page.getByText("Questions attempted: 1", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await signIn(page, bob.email!);
    await page.goto("/team");
    await expect(
      page.getByRole("heading", { name: "Staff access required" }),
    ).toBeVisible();
    await expect(
      page.getByText("Questions attempted: 1", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await db.recursiveDelete(
      db.doc(`teams/team-e2e/assignments/${assignmentId}`),
    );
    for (const user of [teacher, alice, bob, outsider]) {
      await db.recursiveDelete(db.doc(`users/${user.uid}`));
      await db.doc(`staff/${user.uid}`).delete();
      await db.doc(`teams/team-e2e/members/${user.uid}`).delete();
      await db.doc(`teams/other/members/${user.uid}`).delete();
      await auth.deleteUser(user.uid);
    }
  }
});

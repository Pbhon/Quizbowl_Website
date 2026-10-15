import {
  test,
  expect,
  type APIRequestContext,
  type Page,
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
    getApps().find((app) => app.name === "task10-high") ||
    initializeApp({ projectId: "demo-quizbowl" }, "task10-high");
  return { db: getFirestore(app), auth: getAuth(app) };
}
async function headers(request: APIRequestContext, email: string) {
  const response = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
    { data: { email, password: "quizbowl-test-123", returnSecureToken: true } },
  );
  expect(response.ok()).toBeTruthy();
  return { Authorization: `Bearer ${(await response.json()).idToken}` };
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
const question = {
  id: "assigned-bonus",
  type: "bonus",
  category: "Science",
  subcategory: "Biology",
  difficulty: 4,
  source: "Test packet",
  leadin: "Cells",
  parts: ["Cells contain this molecule.", "Cells contain this organelle."],
  answers: ["DNA", "nucleus"],
  answerLines: ["DNA", "nucleus"],
};

test("automatic assignment progress is atomic, unique by source, and bound to current requirements", async ({
  page,
  request,
}) => {
  test.skip(!enabled, "Requires Firebase emulators");
  test.setTimeout(90000);
  const { db, auth } = services();
  const teacher = await auth.createUser({
    email: `high-teacher-${crypto.randomUUID()}@example.com`,
    password: "quizbowl-test-123",
    emailVerified: true,
    displayName: "Teacher",
  });
  const student = await auth.createUser({
    email: `high-student-${crypto.randomUUID()}@example.com`,
    password: "quizbowl-test-123",
    emailVerified: true,
    displayName: "Student",
  });
  const assignmentId = crypto.randomUUID(),
    assignmentRef = db.doc(`teams/team-e2e/assignments/${assignmentId}`);
  try {
    for (const user of [teacher, student])
      await db
        .doc(`teams/team-e2e/members/${user.uid}`)
        .set({ displayName: user.displayName });
    await db
      .doc(`staff/${teacher.uid}`)
      .set({ role: "teacher", teamId: "team-e2e" });
    const teacherHeaders = await headers(request, teacher.email!),
      studentHeaders = await headers(request, student.email!);
    await assignmentRef.set({
      title: "Assigned cells",
      published: true,
      audience: "team",
      questionCount: 1,
      type: "bonus",
      difficultyMin: 2,
      difficultyMax: 6,
      category: "Science",
      subcategory: "Biology",
      topic: "Cells",
      requirementsVersion: 1,
    });
    async function session(assigned = true) {
      const id = crypto.randomUUID(),
        ref = db.doc(`users/${student.uid}/practiceSessions/${id}`);
      await ref.set({
        createdAt: Timestamp.now(),
        questionCount: 1,
        totalParts: 2,
        attemptedParts: 0,
        correct: 0,
        incorrect: 0,
        skipped: 0,
        ...(assigned
          ? {
              assignment: {
                id: assignmentId,
                teamId: "team-e2e",
                requirementsVersion: 1,
              },
            }
          : {}),
      });
      await ref.collection("questions").doc("0").set(question);
      return id;
    }
    const sessionId = await session(),
      repeatSession = await session(),
      staleSession = await session(),
      ordinarySession = await session(false);
    async function skip(
      id: string,
      part: number,
      requestId = crypto.randomUUID(),
    ) {
      return request.post("/api/practice/attempts", {
        headers: studentHeaders,
        data: {
          sessionId: id,
          questionIndex: 0,
          part,
          requestId,
          givenAnswer: "",
          skipped: true,
          revealedWords: 0,
        },
      });
    }
    expect((await skip(ordinarySession, 0)).status()).toBe(200);
    expect(
      (await assignmentRef.collection("progress").doc(student.uid).get())
        .exists,
    ).toBe(false);
    await signIn(page, student.email!);
    await page.goto("/assignments");
    await page.getByRole("link", { name: "Practice assignment" }).click();
    // Substitute upstream question retrieval only; all answer/progress writes use real server routes.
    await page.route("**/api/practice/questions", async (route) => {
      expect(route.request().postDataJSON().assignmentId).toBe(assignmentId);
      await route.fulfill({
        json: {
          sessionId,
          questions: [question],
          assignmentTitle: "Assigned cells",
        },
      });
    });
    await page
      .getByRole("button", { name: "Start session", exact: true })
      .click();
    await page.getByRole("button", { name: "Skip and reveal answer" }).click();
    await expect
      .poll(
        async () =>
          (
            await assignmentRef.collection("progress").doc(student.uid).get()
          ).data()?.skipped,
      )
      .toBe(1);
    expect(
      (
        await assignmentRef.collection("progress").doc(student.uid).get()
      ).data()!.completedQuestions,
    ).toBe(0);
    await page.getByRole("button", { name: "Next part" }).click();
    await page.getByRole("button", { name: "Skip and reveal answer" }).click();
    await expect
      .poll(
        async () =>
          (
            await assignmentRef.collection("progress").doc(student.uid).get()
          ).data()?.completedQuestions,
      )
      .toBe(1);
    const sameRequest = crypto.randomUUID();
    for (const response of await Promise.all([
      skip(repeatSession, 0, sameRequest),
      skip(repeatSession, 0, sameRequest),
      skip(repeatSession, 1),
    ]))
      expect(response.status()).toBe(200);
    expect(
      (
        await assignmentRef.collection("progress").doc(student.uid).get()
      ).data()!.skipped,
    ).toBe(2);
    await page.goto("/assignments");
    await expect(
      page.getByRole("cell", { name: "completed", exact: true }),
    ).toBeVisible();
    const update = await request.post("/api/assignments", {
      headers: teacherHeaders,
      data: {
        action: "update",
        id: assignmentId,
        title: "New cells requirements",
        published: true,
        audience: "team",
        questionCount: 2,
        type: "bonus",
        difficultyMin: 2,
        difficultyMax: 6,
        category: "Science",
        subcategory: "Biology",
        topic: "Cells",
      },
    });
    expect(update.status()).toBe(200);
    expect((await assignmentRef.get()).data()!.requirementsVersion).toBe(2);
    expect((await skip(staleSession, 0)).status()).toBe(409);
    const refreshed = await request.get("/api/assignments", {
      headers: studentHeaders,
    });
    expect(
      (await refreshed.json()).assignments.find(
        (row: { id: string }) => row.id === assignmentId,
      ).results[0].completedQuestions,
    ).toBe(0);
    await db.doc(`teams/team-e2e/members/${student.uid}`).delete();
    expect(
      (
        await request.post("/api/practice/questions", {
          headers: studentHeaders,
          data: { assignmentId },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await db.recursiveDelete(assignmentRef);
    for (const user of [teacher, student]) {
      await db.recursiveDelete(db.doc(`users/${user.uid}`));
      await db.doc(`teams/team-e2e/members/${user.uid}`).delete();
      await db.doc(`staff/${user.uid}`).delete();
      await auth.deleteUser(user.uid);
    }
  }
});

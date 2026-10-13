import { test, expect } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
const enabled = process.env.E2E_FIREBASE === "true";
if (enabled) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}
test("assignment authoring, saved results, teacher curation and shared practice/export", async ({
  page,
  request,
}, info) => {
  test.skip(!enabled, "Requires Firebase emulators");
  test.setTimeout(90000);
  const app =
    getApps().find((app) => app.name === "assignment-tests") ||
    initializeApp({ projectId: "demo-quizbowl" }, "assignment-tests");
  const auth = getAuth(app),
    db = getFirestore(app);
  const users = [];
  const assignmentIds: string[] = [];
  let shareId = "";
  try {
    for (const name of ["Teacher", "Student", "Groupmate"]) {
      const user = await auth.createUser({
        email: `assignment-${crypto.randomUUID()}@example.com`,
        password: "quizbowl-test-123",
        emailVerified: true,
        displayName: name,
      });
      users.push(user);
      await db
        .doc(`teams/team-e2e/members/${user.uid}`)
        .set({ displayName: name });
    }
    const [teacher, student, groupmate] = users;
    await db
      .doc(`staff/${teacher.uid}`)
      .set({ role: "teacher", teamId: "team-e2e" });
    async function headers(email: string) {
      const result = await request.post(
        "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
        {
          data: {
            email,
            password: "quizbowl-test-123",
            returnSecureToken: true,
          },
        },
      );
      return { Authorization: `Bearer ${(await result.json()).idToken}` };
    }
    const teacherHeaders = await headers(teacher.email!),
      studentHeaders = await headers(student.email!);
    const base = {
      action: "create",
      title: "Group biology",
      description: "Review cells",
      published: true,
      audience: "students",
      studentUids: [student.uid, groupmate.uid],
      questionCount: 20,
      difficultyMin: 2,
      difficultyMax: 6,
      category: "Science",
      subcategory: "Biology",
      topic: "cells",
      dueAt: "2026-12-01T23:30:00.000Z",
    };
    expect(
      (
        await request.post("/api/assignments", {
          headers: studentHeaders,
          data: base,
        })
      ).status(),
    ).toBe(403);
    const created = await request.post("/api/assignments", {
      headers: teacherHeaders,
      data: base,
    });
    expect(created.status()).toBe(200);
    const id = (await created.json()).assignmentId;
    assignmentIds.push(id);
    await db
      .doc(`teams/team-e2e/assignments/${id}/progress/${student.uid}`)
      .set({ completedQuestions: 4, correct: 3, incorrect: 1, skipped: 0 });
    const draft = await request.post("/api/assignments", {
      headers: teacherHeaders,
      data: { ...base, title: "Private draft", published: false },
    });
    assignmentIds.push((await draft.json()).assignmentId);
    const own = await request.get("/api/assignments", {
      headers: studentHeaders,
    });
    const ownBody = await own.json();
    expect(ownBody.assignments.map((a: { id: string }) => a.id)).toEqual([id]);
    expect(ownBody.assignments[0].results[0].accuracy).toBe(75);
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(teacher.email!);
    await page
      .getByLabel("Password", { exact: true })
      .fill("quizbowl-test-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByText("You’re signed in", { exact: true }),
    ).toBeVisible();
    await page.goto("/assignments");
    await expect(
      page.getByRole("heading", { name: "Group biology", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("75.0%", { exact: true })).toBeVisible();
    const card = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("heading", { name: "Group biology", exact: true }),
    });
    await card.getByRole("button", { name: "Edit assignment" }).click();
    await expect(page.getByLabel("Question count")).toHaveValue("20");
    await expect(page.getByLabel("Category", { exact: true })).toHaveValue(
      "Science",
    );
    await page.getByLabel("Title", { exact: true }).fill("Edited biology");
    await page.getByRole("button", { name: "Save assignment" }).click();
    await expect(
      page.getByRole("heading", { name: "Edited biology", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("assignments.png"),
      fullPage: true,
    });
    await page.goto("/teacher-decks");
    await page.getByLabel("Deck name", { exact: true }).fill("Curated biology");
    await page.getByLabel("Topic tags", { exact: true }).fill("cells, biology");
    await page
      .getByRole("button", { name: "Create deck", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Curated biology", exact: true }),
    ).toBeVisible();
    const decks = (
      await (
        await request.get("/api/decks", { headers: teacherHeaders })
      ).json()
    ).decks;
    expect(
      decks.find((deck: { name: string }) => deck.name === "Curated biology")
        .teacherCurated,
    ).toBe(true);
    expect(
      (
        await request.post("/api/decks", {
          headers: studentHeaders,
          data: {
            action: "create",
            name: "Fake staff deck",
            teacherCurated: true,
          },
        })
      ).status(),
    ).toBe(403);
    // Exercise a pre-existing school share; teacher-sharing implementation remains deferred.
    const deckId = "existing-share";
    shareId = createHash("sha256")
      .update(`${teacher.uid}/${deckId}`)
      .digest("hex");
    await db.doc(`users/${teacher.uid}/decks/${deckId}`).set({
      name: "Existing shared biology",
      visibility: "team",
      teamId: "team-e2e",
      createdAt: Timestamp.now(),
    });
    await db
      .doc(`teams/team-e2e/sharedDecks/${shareId}`)
      .set({ ownerUid: teacher.uid, deckId });
    const question = {
      id: "shared-biology",
      type: "tossup",
      category: "Science",
      subcategory: "Biology",
      difficulty: 4,
      source: "Test packet",
      leadin: "",
      parts: ["This molecule stores genetic information."],
      answers: ["DNA"],
      answerLines: ["DNA"],
    };
    await db
      .doc(`users/${teacher.uid}/decks/${deckId}/questions/q`)
      .set({ question, originalQuestion: question, tags: [] });
    const session = await request.post("/api/practice/questions", {
      headers: studentHeaders,
      data: { sharedId: shareId, count: 10 },
    });
    expect(session.status()).toBe(200);
    const sessionData = await session.json();
    expect(sessionData.questions).toEqual([question]);
    expect(
      (
        await db
          .doc(
            `users/${student.uid}/practiceSessions/${sessionData.sessionId}/questions/0`,
          )
          .get()
      ).data()!,
    ).toEqual(question);
    const download = await request.post("/api/decks/export", {
      headers: studentHeaders,
      data: { sharedId: shareId },
    });
    expect(download.status()).toBe(200);
    expect((await download.body()).subarray(0, 2).toString()).toBe("PK");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(student.email!);
    await page
      .getByLabel("Password", { exact: true })
      .fill("quizbowl-test-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByText("You’re signed in", { exact: true }),
    ).toBeVisible();
    await page.goto("/assignments");
    await expect(
      page.getByRole("heading", { name: "Edited biology", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Private draft", exact: true }),
    ).toHaveCount(0);
    await page.goto("/decks");
    await page.getByLabel("Show decks").selectOption("team");
    await page
      .locator("summary")
      .filter({ hasText: "Existing shared biology" })
      .click();
    await page.locator("summary").filter({ hasText: "Export to Anki" }).click();
    const csvEvent = page.waitForEvent("download", { timeout: 10000 });
    await page
      .getByRole("button", { name: "Download Anki CSV", exact: true })
      .click();
    expect((await csvEvent).suggestedFilename()).toMatch(/\.csv$/);
    await page.getByRole("link", { name: "Practice shared deck" }).click();
    await page
      .getByRole("button", { name: "Start session", exact: true })
      .click();
    await expect(
      page.getByText(/Practicing 1 original questions/),
    ).toBeVisible();
    await db
      .doc(`users/${teacher.uid}/decks/${deckId}`)
      .update({ visibility: "private" });
    expect(
      (
        await request.post("/api/practice/questions", {
          headers: studentHeaders,
          data: { sharedId: shareId, count: 10 },
        })
      ).status(),
    ).toBe(404);
  } finally {
    for (const id of assignmentIds)
      await db.recursiveDelete(db.doc(`teams/team-e2e/assignments/${id}`));
    if (shareId) await db.doc(`teams/team-e2e/sharedDecks/${shareId}`).delete();
    for (const user of users) {
      await db.recursiveDelete(db.doc(`users/${user.uid}`));
      await db.doc(`staff/${user.uid}`).delete();
      await db.doc(`teams/team-e2e/members/${user.uid}`).delete();
      await auth.deleteUser(user.uid);
    }
  }
});

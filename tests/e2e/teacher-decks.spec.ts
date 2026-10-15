import { test, expect } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
const enabled = process.env.E2E_FIREBASE === "true";
if (enabled) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}
test("teacher sharing, student study/export, revocation and school staff removal", async ({
  page,
  request,
}) => {
  test.skip(!enabled, "Requires Firebase emulators");
  test.setTimeout(60000);
  const app =
    getApps().find((app) => app.name === "teacher-decks-tests") ||
    initializeApp({ projectId: "demo-quizbowl" }, "teacher-decks-tests");
  const auth = getAuth(app),
    db = getFirestore(app),
    users = [];
  const shareIds: string[] = [];
  try {
    for (const name of ["Teacher", "Student", "Outsider"]) {
      const user = await auth.createUser({
        email: `teacher-deck-${crypto.randomUUID()}@example.com`,
        displayName: name,
        emailVerified: true,
        password: "quizbowl-test-123",
      });
      users.push(user);
      await db
        .doc(
          `teams/${name === "Outsider" ? "other-school" : "team-e2e"}/members/${user.uid}`,
        )
        .set({ displayName: name });
    }
    const [teacher, student, outsider] = users;
    await db
      .doc(`staff/${teacher.uid}`)
      .set({ role: "teacher", teamId: "team-e2e" });
    async function authorization(email: string) {
      const response = await request.post(
        "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
        {
          data: {
            email,
            password: "quizbowl-test-123",
            returnSecureToken: true,
          },
        },
      );
      return { Authorization: `Bearer ${(await response.json()).idToken}` };
    }
    const teacherHeaders = await authorization(teacher.email!),
      studentHeaders = await authorization(student.email!),
      outsiderHeaders = await authorization(outsider.email!);
    const created = await request.post("/api/decks", {
      headers: teacherHeaders,
      data: { action: "create", name: "Teacher cells", teacherCurated: true },
    });
    expect(created.status()).toBe(200);
    const deckId = (await created.json()).deckId;
    const deckRef = db.doc(`users/${teacher.uid}/decks/${deckId}`);
    const question = {
      id: "teacher-q",
      type: "tossup",
      category: "Science",
      subcategory: "Biology",
      difficulty: 4,
      source: "Test source",
      leadin: "",
      parts: ["Name this cell molecule."],
      answers: ["DNA"],
      answerLines: ["DNA"],
    };
    await deckRef
      .collection("questions")
      .doc("q")
      .set({ question, originalQuestion: question, tags: [] });
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(teacher.email!);
    await page
      .getByLabel("Password", { exact: true })
      .fill("quizbowl-test-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByText("You’re signed in", { exact: true }),
    ).toBeVisible();
    await page.goto("/teacher-decks");
    await page.locator("summary").filter({ hasText: "Teacher cells" }).click();
    await page
      .getByRole("button", { name: "Share with students", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Stop sharing with students" }),
    ).toBeVisible();
    async function decks(headers: Record<string, string>) {
      const response = await request.get("/api/decks", { headers });
      expect(response.status()).toBe(200);
      return (await response.json()).decks;
    }
    const shared = (await decks(studentHeaders)).find(
      (deck: { name: string }) => deck.name === "Teacher cells",
    );
    expect(shared.teacherCurated).toBe(true);
    expect(shared.canEdit).toBe(false);
    shareIds.push(shared.sharedId);
    expect(
      (await decks(outsiderHeaders)).some(
        (deck: { name: string }) => deck.name === "Teacher cells",
      ),
    ).toBe(false);
    expect(
      (
        await request.post("/api/decks/export", {
          headers: studentHeaders,
          data: { sharedId: shared.sharedId },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.post("/api/practice/questions", {
          headers: studentHeaders,
          data: { sharedId: shared.sharedId, count: 1 },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.post("/api/decks", {
          headers: studentHeaders,
          data: {
            action: "save",
            sourceSharedId: shared.sharedId,
            cardId: "q",
            deckIds: ["starred"],
          },
        })
      ).status(),
    ).toBe(200);
    await page
      .getByRole("button", { name: "Stop sharing with students" })
      .click();
    await expect(
      page.getByRole("button", { name: "Share with students", exact: true }),
    ).toBeVisible();
    expect(
      (await decks(studentHeaders)).some(
        (deck: { name: string }) => deck.name === "Teacher cells",
      ),
    ).toBe(false);
    expect(
      (
        await request.post("/api/decks/export", {
          headers: studentHeaders,
          data: { sharedId: shared.sharedId },
        })
      ).status(),
    ).toBe(404);
    expect(
      (await db.doc(`teams/team-e2e/sharedDecks/${shared.sharedId}`).get())
        .exists,
    ).toBe(false);
    await page
      .getByRole("button", { name: "Share with students", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Stop sharing with students" }),
    ).toBeVisible();
    await db.doc(`staff/${teacher.uid}`).delete();
    expect(
      (await decks(studentHeaders)).some(
        (deck: { name: string }) => deck.name === "Teacher cells",
      ),
    ).toBe(false);
    expect(
      (
        await request.post("/api/decks/export", {
          headers: studentHeaders,
          data: { sharedId: shared.sharedId },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post("/api/decks", {
          headers: teacherHeaders,
          data: { action: "shareTeacher", deckId, visibility: "team" },
        })
      ).status(),
    ).toBe(403);
  } finally {
    for (const id of shareIds)
      await db.doc(`teams/team-e2e/sharedDecks/${id}`).delete();
    for (const user of users) {
      await db.recursiveDelete(db.doc(`users/${user.uid}`));
      await db.doc(`staff/${user.uid}`).delete();
      await db.doc(`teams/team-e2e/members/${user.uid}`).delete();
      await db.doc(`teams/other-school/members/${user.uid}`).delete();
      await auth.deleteUser(user.uid);
    }
  }
});

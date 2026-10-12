import { test, expect } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
const enabled = process.env.E2E_FIREBASE === "true";
if (enabled) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}
function services() {
  const app =
    getApps().find((a) => a.name === "practice-tests") ||
    initializeApp({ projectId: "demo-quizbowl" }, "practice-tests");
  return { auth: getAuth(app), db: getFirestore(app) };
}
const question = {
  id: "canonical-bonus",
  type: "bonus",
  category: "Science",
  subcategory: "Biology",
  difficulty: 4,
  source: "Persistence test",
  leadin: "Answer these questions.",
  parts: [
    "Name the powerhouse.",
    "Name the genetic material.",
    "Name this explorer.",
    "Name the protein factory.",
  ],
  answers: [
    "<b><u>mitochondria</u></b>",
    "<b><u>DNA</u></b>",
    "<b><u>John Smith</u></b> [prompt on Smith]",
    "<b><u>ribosome</u></b>",
  ],
  answerLines: [
    "mitochondria",
    "DNA",
    "John Smith [prompt on Smith]",
    "ribosome",
  ],
};
async function seed(uid: string) {
  const id = crypto.randomUUID();
  const ref = services().db.doc(`users/${uid}/practiceSessions/${id}`);
  await ref.set({
    createdAt: FieldValue.serverTimestamp(),
    questionCount: 1,
    totalParts: 4,
    attemptedParts: 0,
    correct: 0,
    incorrect: 0,
    skipped: 0,
  });
  await ref.collection("questions").doc("0").set(question);
  return id;
}
async function fixture() {
  return services().auth.createUser({
    email: `attempt-${crypto.randomUUID()}@example.com`,
    password: "quizbowl-test-123",
    displayName: "Attempt student",
  });
}

test("signed-in practice saves every response and retries lost acknowledgements without duplicates", async ({
  page,
  request,
}) => {
  test.skip(
    !enabled,
    "Requires Firebase emulators and live QBReader answer checking",
  );
  const user = await fixture();
  const sessionId = await seed(user.uid);
  const { db, auth } = services();
  try {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(user.email!);
    await page
      .getByLabel("Password", { exact: true })
      .fill("quizbowl-test-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByText("You’re signed in", { exact: true }),
    ).toBeVisible();
    await page.route("**/api/practice/questions", (route) =>
      route.fulfill({ json: { questions: [question], sessionId } }),
    );
    const payloads: Record<string, unknown>[] = [];
    let loseFirst = true;
    await page.route("**/api/practice/attempts", async (route) => {
      payloads.push(route.request().postDataJSON());
      const response = await route.fetch();
      if (loseFirst) {
        loseFirst = false;
        expect(response.status()).toBe(200);
        await route.fulfill({
          status: 503,
          json: { error: "Save acknowledgement lost. Please retry." },
        });
      } else await route.fulfill({ response });
    });
    await page.goto("/practice");
    await page.getByLabel("Question type").selectOption("bonus");
    await page.getByRole("button", { name: "Start session" }).click();
    await page.getByLabel("Your answer", { exact: true }).fill("mitochondria");
    await page
      .getByRole("button", { name: "Check answer", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "acknowledgement lost",
    );
    await expect(
      page.getByLabel("Your answer", { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Correct: 0 · Incorrect: 0 · Skipped: 0"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Check answer", exact: true })
      .click();
    await expect(
      page.getByText("Correct: 1 · Incorrect: 0 · Skipped: 0"),
    ).toBeVisible();
    expect(payloads[0].requestId).toBe(payloads[1].requestId);
    await page.getByRole("button", { name: "Next part" }).click();
    await page.getByLabel("Your answer", { exact: true }).fill("banana");
    await page
      .getByRole("button", { name: "Check answer", exact: true })
      .click();
    await expect(
      page.getByText("Correct: 1 · Incorrect: 1 · Skipped: 0"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next part" }).click();
    await page.getByLabel("Your answer", { exact: true }).fill("Smith");
    await page
      .getByRole("button", { name: "Check answer", exact: true })
      .click();
    await expect(page.getByLabel("Clarify your answer")).toBeVisible();
    const promptDoc = db.doc(`users/${user.uid}/attempts/${sessionId}_0_2`);
    expect((await promptDoc.get()).data()?.outcome).toBe("prompt");
    await page.getByLabel("Clarify your answer").fill("John Smith");
    await page
      .getByRole("button", { name: "Check answer", exact: true })
      .click();
    await page.getByRole("button", { name: "Next part" }).click();
    await page.getByRole("button", { name: "Skip and reveal answer" }).click();
    await page.getByRole("button", { name: "View summary" }).click();
    await expect(page.getByText("67%", { exact: true })).toBeVisible();
    const records = await db.collection(`users/${user.uid}/attempts`).get();
    expect(records.size).toBe(4);
    const first = records.docs.find((d) => d.data().part === 0)!.data();
    expect(first.submissions).toHaveLength(1);
    expect(first.outcome).toBe("correct");
    expect(first.createdAt.toMillis()).toBeGreaterThan(0);
    expect(first.question.answers[0]).toBe(question.answers[0]);
    const prompted = (await promptDoc.get()).data()!;
    expect(prompted.outcome).toBe("correct");
    expect(
      prompted.submissions.map((s: { directive: string }) => s.directive),
    ).toEqual(["prompt", "accept"]);
    const skipped = records.docs.find((d) => d.data().part === 3)!.data();
    expect(skipped.outcome).toBe("skipped");
    expect(skipped.submittedAnswer).toBe("");
    const session = (
      await db.doc(`users/${user.uid}/practiceSessions/${sessionId}`).get()
    ).data()!;
    expect(session).toMatchObject({
      attemptedParts: 4,
      correct: 2,
      incorrect: 1,
      skipped: 1,
    });
    expect(session.completedAt.toMillis()).toBeGreaterThan(0);
    // Read persisted results through the actual owner security rules after reloading.
    await page.reload();
    const login = await request.post(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
      {
        data: {
          email: user.email,
          password: "quizbowl-test-123",
          returnSecureToken: true,
        },
      },
    );
    const token = (await login.json()).idToken;
    const read = await request.get(
      `http://127.0.0.1:8080/v1/projects/demo-quizbowl/databases/(default)/documents/users/${user.uid}/attempts/${sessionId}_0_0`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(read.status()).toBe(200);
    const forged = await request.post("/api/practice/attempts", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        ...payloads[0],
        givenAnswer: "forged",
        requestId: crypto.randomUUID(),
      },
    });
    expect(forged.status()).toBe(409);
    const other = await fixture();
    try {
      const otherLogin = await request.post(
        "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
        {
          data: {
            email: other.email,
            password: "quizbowl-test-123",
            returnSecureToken: true,
          },
        },
      );
      const otherToken = (await otherLogin.json()).idToken;
      const stolen = await request.post("/api/practice/attempts", {
        headers: { Authorization: `Bearer ${otherToken}` },
        data: payloads[0],
      });
      expect(stolen.status()).toBe(404);
    } finally {
      await auth.deleteUser(other.uid);
    }
  } finally {
    await db.recursiveDelete(db.doc(`users/${user.uid}`));
    await auth.deleteUser(user.uid);
  }
});

test("simultaneous retries save one skip and increment session totals once", async ({
  request,
}) => {
  test.skip(!enabled, "Requires Firebase emulators");
  const user = await fixture();
  const { auth, db } = services();
  const sessionId = await seed(user.uid);
  try {
    const login = await request.post(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
      {
        data: {
          email: user.email,
          password: "quizbowl-test-123",
          returnSecureToken: true,
        },
      },
    );
    const token = (await login.json()).idToken;
    const payload = {
      sessionId,
      questionIndex: 0,
      part: 0,
      requestId: crypto.randomUUID(),
      givenAnswer: "",
      skipped: true,
      revealedWords: 0,
    };
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        request.post("/api/practice/attempts", {
          headers: { Authorization: `Bearer ${token}` },
          data: payload,
        }),
      ),
    );
    for (const response of responses) expect(response.status()).toBe(200);
    expect((await db.collection(`users/${user.uid}/attempts`).get()).size).toBe(
      1,
    );
    expect(
      (
        await db.doc(`users/${user.uid}/practiceSessions/${sessionId}`).get()
      ).data(),
    ).toMatchObject({ attemptedParts: 1, skipped: 1 });
    const mismatch = await request.post("/api/practice/attempts", {
      headers: { Authorization: `Bearer ${token}` },
      data: { ...payload, revealedWords: 1 },
    });
    expect(mismatch.status()).toBe(409);
  } finally {
    await db.recursiveDelete(db.doc(`users/${user.uid}`));
    await auth.deleteUser(user.uid);
  }
});

test("attempt recording requires authentication", async ({ request }) => {
  const response = await request.post("/api/practice/attempts", { data: {} });
  expect(response.status()).toBe(401);
});

test("one submission ID cannot create history for competing parts or sessions", async ({
  request,
}) => {
  test.skip(!enabled, "Requires Firebase emulators");
  const user = await fixture();
  const other = await fixture();
  const { auth, db } = services();
  const sessionId = await seed(user.uid);
  try {
    async function tokenFor(email: string) {
      const login = await request.post(
        "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
        {
          data: {
            email,
            password: "quizbowl-test-123",
            returnSecureToken: true,
          },
        },
      );
      return (await login.json()).idToken as string;
    }
    const token = await tokenFor(user.email!);
    const headers = { Authorization: `Bearer ${token}` };
    const payload = {
      sessionId,
      questionIndex: 0,
      part: 0,
      requestId: crypto.randomUUID(),
      givenAnswer: "",
      skipped: true,
      revealedWords: 0,
    };
    const responses = await Promise.all(
      [0, 1].map((part) =>
        request.post("/api/practice/attempts", {
          headers,
          data: { ...payload, part },
        }),
      ),
    );
    expect(responses.map((r) => r.status()).sort()).toEqual([200, 409]);
    const savedPart = responses.findIndex((r) => r.status() === 200);
    const saved = { ...payload, part: savedPart };
    const original = await responses[savedPart].json();
    for (let i = 0; i < 3; i++) {
      const replay = await request.post("/api/practice/attempts", {
        headers,
        data: {
          ...saved,
          sessionId: sessionId.toUpperCase(),
          requestId: payload.requestId.toUpperCase(),
        },
      });
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toEqual(original);
    }
    const newSession = await seed(user.uid);
    const conflict = await request.post("/api/practice/attempts", {
      headers,
      data: { ...saved, sessionId: newSession },
    });
    expect(conflict.status()).toBe(409);
    // A new ID cannot resubmit a finished part either.
    expect(
      (
        await request.post("/api/practice/attempts", {
          headers,
          data: { ...saved, requestId: crypto.randomUUID() },
        })
      ).status(),
    ).toBe(409);
    expect((await db.collection(`users/${user.uid}/attempts`).get()).size).toBe(
      1,
    );
    expect(
      (await db.collection(`users/${user.uid}/attemptSubmissions`).get()).size,
    ).toBe(1);
    expect(
      (
        await db.doc(`users/${user.uid}/practiceSessions/${sessionId}`).get()
      ).data(),
    ).toMatchObject({ attemptedParts: 1, skipped: 1 });
    expect(
      (
        await db.doc(`users/${user.uid}/practiceSessions/${newSession}`).get()
      ).data(),
    ).toMatchObject({ attemptedParts: 0, skipped: 0 });
    // Separate parts and deliberate retry sessions keep independent attempts.
    for (const data of [
      { ...payload, part: 1 - savedPart, requestId: crypto.randomUUID() },
      { ...payload, sessionId: newSession, requestId: crypto.randomUUID() },
    ])
      expect(
        (
          await request.post("/api/practice/attempts", { headers, data })
        ).status(),
      ).toBe(200);
    const history = await request.get("/api/history", { headers });
    expect(history.status()).toBe(200);
    expect((await history.json()).attempts).toHaveLength(3);
    expect(
      (
        await db.doc(`users/${user.uid}/practiceSessions/${sessionId}`).get()
      ).data(),
    ).toMatchObject({ attemptedParts: 2, skipped: 2 });
    // IDs are scoped to accounts, so another student's identical ID is independent.
    const otherSession = await seed(other.uid);
    const otherToken = await tokenFor(other.email!);
    expect(
      (
        await request.post("/api/practice/attempts", {
          headers: { Authorization: `Bearer ${otherToken}` },
          data: { ...payload, sessionId: otherSession },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await db.collection(`users/${other.uid}/attempts`).get()).size,
    ).toBe(1);
  } finally {
    for (const account of [user, other]) {
      await db.recursiveDelete(db.doc(`users/${account.uid}`));
      await auth.deleteUser(account.uid);
    }
  }
});

test("lost skip acknowledgements retry the same submission and show one history row after reload", async ({
  page,
}) => {
  test.skip(!enabled, "Requires Firebase emulators");
  const user = await fixture();
  const sessionId = await seed(user.uid);
  const { db, auth } = services();
  try {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(user.email!);
    await page
      .getByLabel("Password", { exact: true })
      .fill("quizbowl-test-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByText("You’re signed in", { exact: true }),
    ).toBeVisible();
    await page.route("**/api/practice/questions", (route) =>
      route.fulfill({ json: { questions: [question], sessionId } }),
    );
    let loseFirst = true;
    const ids: string[] = [];
    await page.route("**/api/practice/attempts", async (route) => {
      ids.push(route.request().postDataJSON().requestId);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (loseFirst) {
        loseFirst = false;
        await route.fulfill({
          status: 503,
          json: { error: "Save acknowledgement lost. Please retry." },
        });
      } else await route.fulfill({ response });
    });
    await page.goto("/practice");
    await page.getByRole("button", { name: "Start session" }).click();
    await page.getByRole("button", { name: "Skip and reveal answer" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "acknowledgement lost",
    );
    await page.getByRole("button", { name: "Skip and reveal answer" }).click();
    await expect(
      page.getByText("Correct: 0 · Incorrect: 0 · Skipped: 1"),
    ).toBeVisible();
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    await page.goto("/history");
    await expect(page.locator('[data-slot="card"]')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('[data-slot="card"]')).toHaveCount(1);
    const attempt = (
      await db.collection(`users/${user.uid}/attempts`).get()
    ).docs[0].data();
    expect(attempt.submissions).toHaveLength(1);
    expect(
      (
        await db.doc(`users/${user.uid}/practiceSessions/${sessionId}`).get()
      ).data(),
    ).toMatchObject({ attemptedParts: 1, skipped: 1 });
  } finally {
    await db.recursiveDelete(db.doc(`users/${user.uid}`));
    await db.doc(`teams/team-e2e/members/${user.uid}`).delete();
    await auth.deleteUser(user.uid);
  }
});

test("authenticated question fetching creates a canonical session", async ({
  request,
}) => {
  test.skip(
    !enabled || process.env.QBREADER_LIVE !== "true",
    "Requires Firebase emulators and opt-in live QBReader",
  );
  const user = await fixture();
  const { auth, db } = services();
  try {
    const login = await request.post(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
      {
        data: {
          email: user.email,
          password: "quizbowl-test-123",
          returnSecureToken: true,
        },
      },
    );
    const token = (await login.json()).idToken;
    const response = await request.post("/api/practice/questions", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        type: "tossup",
        count: 1,
        difficulty: 4,
        category: "Science",
        subcategory: "Biology",
        topic: "",
        excluded: [],
      },
    });
    expect(response.status()).toBe(200);
    const { questions, sessionId } = await response.json();
    expect(sessionId).toBeTruthy();
    expect(
      (
        await db
          .doc(`users/${user.uid}/practiceSessions/${sessionId}/questions/0`)
          .get()
      ).data(),
    ).toEqual(questions[0]);
    const skip = await request.post("/api/practice/attempts", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        sessionId,
        questionIndex: 0,
        part: 0,
        requestId: crypto.randomUUID(),
        givenAnswer: "",
        skipped: true,
        revealedWords: 0,
      },
    });
    expect(skip.status()).toBe(200);
  } finally {
    await db.recursiveDelete(db.doc(`users/${user.uid}`));
    await auth.deleteUser(user.uid);
  }
});

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
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("quizbowl-test-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("You’re signed in", { exact: true }),
  ).toBeVisible();
}
async function token(email: string) {
  const response = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "quizbowl-test-123",
        returnSecureToken: true,
      }),
    },
  );
  expect(response.ok).toBe(true);
  return (await response.json()).idToken as string;
}
function api(request: APIRequestContext, idToken: string) {
  const headers = { Authorization: `Bearer ${idToken}` };
  return {
    get: async () => {
      const response = await request.get("/api/decks", { headers });
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toContain("no-store");
      return (await response.json()).decks;
    },
    post: (data: Record<string, unknown>) =>
      request.post("/api/decks", { headers, data }),
    export: (data: Record<string, unknown>) =>
      request.post("/api/decks/export", { headers, data }),
  };
}

test("private/team visibility, owner-only edits, school isolation and revocation", async ({
  page,
  browser,
  request,
}, info) => {
  test.skip(!enabled, "Requires Firebase emulators");
  const app =
    getApps().find((app) => app.name === "sharing-tests") ||
    initializeApp({ projectId: "demo-quizbowl" }, "sharing-tests");
  const auth = getAuth(app),
    db = getFirestore(app);
  const users = [];
  const context = await browser.newContext({
    ...info.project.use,
    baseURL: "http://127.0.0.1:3100",
  });
  const peerPage = await context.newPage();
  const question = {
    id: "sharing-bonus",
    type: "bonus",
    category: "Science",
    subcategory: "Biology",
    difficulty: 4,
    source: "Shared source packet",
    leadin: "Answer both parts.",
    parts: ["First shared clue", "Second shared clue"],
    answers: ["<b>DNA</b>", "<b>RNA</b>"],
    answerLines: ["DNA", "RNA"],
  };
  try {
    for (let i = 0; i < 3; i++)
      users.push(
        await auth.createUser({
          email: `sharing-${crypto.randomUUID()}@example.com`,
          password: "quizbowl-test-123",
        }),
      );
    const [owner, peer, outsider] = users;
    const [ownerApi, peerApi, outsiderApi] = await Promise.all(
      users.map(async (user) => api(request, await token(user.email!))),
    );
    await db
      .doc(`teams/team-e2e/members/${owner.uid}`)
      .set({ displayName: "Deck owner" });
    await db
      .doc(`teams/team-e2e/members/${peer.uid}`)
      .set({ displayName: "Teammate" });
    await db
      .doc(`teams/other-school/members/${outsider.uid}`)
      .set({ displayName: "Outsider" });
    const legacy = db.doc(`users/${owner.uid}/decks/legacy-private`);
    await legacy.set({ name: "Legacy private", createdAt: Timestamp.now() });
    await legacy.collection("questions").doc("legacy-card").set({ question });
    const initial = await ownerApi.get();
    expect(
      initial.find((deck: { id: string }) => deck.id === "legacy-private")
        .visibility,
    ).toBe("private");
    const sessionId = crypto.randomUUID();
    await db
      .doc(`users/${owner.uid}/practiceSessions/${sessionId}`)
      .set({ questionCount: 1 });
    await db
      .doc(`users/${owner.uid}/practiceSessions/${sessionId}/questions/0`)
      .set(question);
    const response = await ownerApi.post({
      action: "create",
      name: "School review",
      visibility: "team",
      teamId: "other-school",
      ownerUid: outsider.uid,
    });
    expect(response.status()).toBe(200);
    const { deckId } = await response.json();
    const ownedRef = db.doc(`users/${owner.uid}/decks/${deckId}`);
    expect((await ownedRef.get()).data()!.teamId).toBe("team-e2e");
    expect(
      (
        await ownerApi.post({
          action: "save",
          sessionId,
          questionIndexes: [0],
          deckIds: [deckId],
        })
      ).status(),
    ).toBe(200);
    const card = (await ownedRef.collection("questions").get()).docs[0];
    const shared = (await peerApi.get()).find(
      (deck: { name: string }) => deck.name === "School review",
    );
    expect(shared).toMatchObject({
      canEdit: false,
      visibility: "team",
      teamName: "Test High School",
    });
    const sharedExport = await peerApi.export({ sharedId: shared.sharedId });
    expect(sharedExport.status()).toBe(200);
    expect(sharedExport.headers()["cache-control"]).toContain("no-store");
    expect(
      (await outsiderApi.export({ sharedId: shared.sharedId })).status(),
    ).toBe(404);
    expect(shared.cards[0].originalQuestion).toEqual(question);
    expect(
      (await peerApi.get()).some(
        (deck: { name: string }) => deck.name === "Legacy private",
      ),
    ).toBe(false);
    expect(
      (await outsiderApi.get()).some(
        (deck: { name: string }) => deck.name === "School review",
      ),
    ).toBe(false);
    for (const bad of ["public", "school", null, 42]) {
      expect(
        (
          await ownerApi.post({
            action: "create",
            name: "Bad visibility",
            visibility: bad,
          })
        ).status(),
      ).toBe(400);
    }
    expect(
      (
        await outsiderApi.post({
          action: "create",
          name: "Wrong school",
          visibility: "team",
          teamId: "other-school",
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await ownerApi.post({
          action: "update",
          deckId: "starred",
          name: "Starred Questions",
          visibility: "team",
        })
      ).status(),
    ).toBe(400);
    for (const attemptedId of [deckId, shared.id]) {
      for (const action of ["update", "delete", "editCard", "removeCard"]) {
        expect(
          (
            await peerApi.post({
              action,
              deckId: attemptedId,
              uid: owner.uid,
              ownerUid: owner.uid,
              name: "Forged",
              cardId: card.id,
              visibility: "private",
            })
          ).status(),
        ).toBe(404);
      }
      expect(
        (
          await peerApi.post({
            action: "save",
            sourceSharedId: shared.sharedId,
            cardId: card.id,
            deckIds: [attemptedId],
          })
        ).status(),
      ).toBe(404);
    }
    expect((await ownedRef.get()).data()!.name).toBe("School review");
    // Direct owner IDs cannot be used as a back door to private question sources.
    expect(
      (
        await peerApi.post({
          action: "save",
          sourceDeckId: "legacy-private",
          ownerUid: owner.uid,
          cardId: "legacy-card",
          deckIds: ["starred"],
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await outsiderApi.post({
          action: "save",
          sourceSharedId: shared.sharedId,
          cardId: card.id,
          deckIds: ["starred"],
        })
      ).status(),
    ).toBe(404);

    await signIn(page, owner.email!);
    await signIn(peerPage, peer.email!);
    await peerPage.goto("/decks");
    await expect(peerPage.getByLabel("Show decks")).toHaveValue("private");
    await expect(
      peerPage.getByRole("heading", { name: "Starred Questions", exact: true }),
    ).toBeVisible();
    await expect(
      peerPage.getByRole("heading", { name: "School review", exact: true }),
    ).toHaveCount(0);
    await peerPage.getByLabel("Show decks").selectOption("team");
    await expect(
      peerPage.getByRole("heading", { name: "Starred Questions", exact: true }),
    ).toHaveCount(0);
    const peerDeck = peerPage.locator('[data-slot="card"]').filter({
      has: peerPage.getByRole("heading", {
        name: "School review",
        exact: true,
      }),
    });
    await expect(
      peerDeck.getByRole("button", { name: "Study flashcards" }),
    ).toBeHidden();
    await peerDeck
      .locator("summary")
      .filter({ hasText: "School review" })
      .click();
    await expect(
      peerDeck.getByRole("button", { name: "Study flashcards" }),
    ).toBeVisible();
    await expect(peerDeck).toContainText("Read-only");
    await expect(
      peerDeck.getByRole("button", { name: "Edit deck", exact: true }),
    ).toHaveCount(0);
    await peerDeck.getByRole("button", { name: "Study flashcards" }).click();
    await expect(
      peerDeck.getByRole("region", { name: "Full-question flashcards" }),
    ).toContainText("Second shared clue");
    await peerDeck.getByRole("button", { name: "Flip to answer" }).click();
    await expect(
      peerDeck.getByRole("region", { name: "Full-question flashcards" }),
    ).toContainText("RNA");
    const questionTitle = peerDeck
      .locator("summary")
      .filter({ hasText: "Difficulty" });
    await expect(questionTitle).toHaveText(
      "Biology · Difficulty 4 · Shared source packet",
    );
    await questionTitle.click();
    await expect(
      peerDeck.getByRole("button", { name: "Edit card", exact: true }),
    ).toHaveCount(0);
    await peerDeck
      .getByRole("button", { name: "Add to deck", exact: true })
      .click();
    await expect(
      peerDeck.getByRole("checkbox", { name: "School review" }),
    ).toHaveCount(0);
    await peerDeck
      .getByRole("checkbox", { name: "Starred Questions", exact: true })
      .check();
    await peerDeck
      .getByRole("button", { name: "Save question", exact: true })
      .click();
    await expect(
      peerDeck.getByText("Question saved to your deck."),
    ).toBeVisible();
    expect(
      (
        await db.collection(`users/${peer.uid}/decks/starred/questions`).get()
      ).docs[0].data().originalQuestion,
    ).toEqual(question);
    await peerPage.screenshot({
      path: info.outputPath("team-shared-decks.png"),
      fullPage: true,
    });
    expect(
      await peerPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // The owner can change visibility in the UI and remove the live share pointer.
    await page.goto("/decks");
    await expect(page.getByLabel("Show decks")).toHaveValue("private");
    await expect(
      page.getByRole("heading", { name: "Legacy private", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "School review", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Show decks").selectOption("team");
    const ownerDeck = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("heading", { name: "School review", exact: true }),
    });
    await ownerDeck
      .locator("summary")
      .filter({ hasText: "School review" })
      .click();
    await ownerDeck
      .getByRole("button", { name: "Edit deck", exact: true })
      .click();
    await ownerDeck.getByLabel("Deck visibility").selectOption("private");
    await ownerDeck.getByRole("button", { name: "Save deck changes" }).click();
    await expect(ownerDeck).toHaveCount(0);
    await expect(page.getByLabel("Show decks")).toHaveValue("team");
    await expect(
      page.getByText("No public decks are shared with your team yet."),
    ).toBeVisible();
    await page.getByLabel("Show decks").selectOption("private");
    await expect(ownerDeck).toContainText("Private · Only you");
    const directoryRef = db.doc(
      `teams/team-e2e/sharedDecks/${shared.sharedId}`,
    );
    expect((await directoryRef.get()).exists).toBe(false);
    expect((await peerApi.export({ sharedId: shared.sharedId })).status()).toBe(
      404,
    );
    // Even a stale directory pointer cannot grant access after unsharing.
    await directoryRef.set({ ownerUid: owner.uid, deckId });
    await peerPage.getByRole("button", { name: "Refresh decks" }).click();
    await expect(
      peerPage.getByRole("heading", { name: "School review" }),
    ).toHaveCount(0);
    await expect(peerPage.getByLabel("Show decks")).toHaveValue("team");
    await expect(
      peerPage.getByText("No public decks are shared with your team yet."),
    ).toBeVisible();
    await peerPage.getByLabel("Show decks").selectOption("private");
    await expect(
      peerPage.getByRole("heading", { name: "Starred Questions", exact: true }),
    ).toBeVisible();
    expect(
      (
        await peerApi.post({
          action: "save",
          sourceSharedId: shared.sharedId,
          cardId: card.id,
          deckIds: ["starred"],
        })
      ).status(),
    ).toBe(404);
    expect(
      (await db.collection(`users/${peer.uid}/decks/starred/questions`).get())
        .size,
    ).toBe(1);
    // Share again, then revoke only the teammate's membership.
    expect(
      (
        await ownerApi.post({
          action: "update",
          deckId,
          name: "School review",
          visibility: "team",
        })
      ).status(),
    ).toBe(200);
    expect(
      (await peerApi.get()).some(
        (deck: { name: string }) => deck.name === "School review",
      ),
    ).toBe(true);
    await db.doc(`teams/team-e2e/members/${peer.uid}`).delete();
    expect((await peerApi.export({ sharedId: shared.sharedId })).status()).toBe(
      404,
    );
    expect(
      (await peerApi.get()).some(
        (deck: { name: string }) => deck.name === "School review",
      ),
    ).toBe(false);
    expect(
      (
        await peerApi.post({
          action: "save",
          sourceSharedId: shared.sharedId,
          cardId: card.id,
          deckIds: ["starred"],
        })
      ).status(),
    ).toBe(404);
    await db
      .doc(`teams/team-e2e/members/${peer.uid}`)
      .set({ displayName: "Teammate" });
    // A mismatched live school cannot be trusted even if its pointer is in this school.
    await ownedRef.update({ teamId: "other-school" });
    expect(
      (await peerApi.get()).some(
        (deck: { name: string }) => deck.name === "School review",
      ),
    ).toBe(false);
    expect(
      (
        await peerApi.post({
          action: "save",
          sourceSharedId: shared.sharedId,
          cardId: card.id,
          deckIds: ["starred"],
        })
      ).status(),
    ).toBe(404);
    await ownedRef.update({ teamId: "team-e2e" });
    const raceDeck = await peerApi.post({
      action: "create",
      name: "Copy race",
    });
    const raceDeckId = (await raceDeck.json()).deckId;
    const [unshare, copy] = await Promise.all([
      ownerApi.post({
        action: "update",
        deckId,
        name: "School review",
        visibility: "private",
      }),
      peerApi.post({
        action: "save",
        sourceSharedId: shared.sharedId,
        cardId: card.id,
        deckIds: [raceDeckId],
      }),
    ]);
    expect(unshare.status()).toBe(200);
    expect([200, 404]).toContain(copy.status());
    expect(
      (
        await db
          .collection(`users/${peer.uid}/decks/${raceDeckId}/questions`)
          .get()
      ).size,
    ).toBe(copy.status() === 200 ? 1 : 0);
    // A copy may commit before revocation, but every later request must fail.
    expect(
      (
        await peerApi.post({
          action: "save",
          sourceSharedId: shared.sharedId,
          cardId: card.id,
          deckIds: [raceDeckId],
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await ownerApi.post({
          action: "update",
          deckId,
          name: "School review",
          visibility: "team",
        })
      ).status(),
    ).toBe(200);
    expect((await ownerApi.post({ action: "delete", deckId })).status()).toBe(
      200,
    );
    expect((await directoryRef.get()).exists).toBe(false);
    expect(
      (await peerApi.get()).some(
        (deck: { name: string }) => deck.name === "School review",
      ),
    ).toBe(false);
  } finally {
    await context.close();
    for (const user of users) {
      const entries = await db
        .collection("teams/team-e2e/sharedDecks")
        .where("ownerUid", "==", user.uid)
        .get();
      await Promise.all(entries.docs.map((doc) => doc.ref.delete()));
      await db.recursiveDelete(db.doc(`users/${user.uid}`));
      await db.doc(`teams/team-e2e/members/${user.uid}`).delete();
      await db.doc(`teams/other-school/members/${user.uid}`).delete();
      await auth.deleteUser(user.uid);
    }
  }
});

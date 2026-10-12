import { test, expect } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { unzipSync } from "fflate";

const enabled = process.env.E2E_FIREBASE === "true";
if (enabled) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}
test("decks: topic import, stars, multiple destinations, edits, flashcards and ownership", async ({
  page,
}, info) => {
  test.skip(!enabled, "Requires Firebase emulators");
  const app =
    getApps().find((app) => app.name === "deck-tests") ||
    initializeApp({ projectId: "demo-quizbowl" }, "deck-tests");
  const auth = getAuth(app),
    db = getFirestore(app);
  const user = await auth.createUser({
    email: `deck-${crypto.randomUUID()}@example.com`,
    password: "quizbowl-test-123",
  });
  const question = {
    id: "deck-bonus",
    type: "bonus",
    category: "Science",
    subcategory: "Biology",
    difficulty: 4,
    source: "Deck test packet",
    leadin: "Answer these biology questions.",
    parts: ["Name the powerhouse.", "Name the photosynthesis organelle."],
    answers: ["<b>mitochondria</b>", "<b>chloroplast</b>"],
    answerLines: ["mitochondria", "chloroplast"],
  };
  const sessionId = crypto.randomUUID();
  try {
    await db
      .doc(`users/${user.uid}/practiceSessions/${sessionId}`)
      .set({ questionCount: 1 });
    await db
      .doc(`users/${user.uid}/practiceSessions/${sessionId}/questions/0`)
      .set(question);
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(user.email!);
    await page
      .getByLabel("Password", { exact: true })
      .fill("quizbowl-test-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByText("You’re signed in", { exact: true }),
    ).toBeVisible();
    // Use canonical emulator questions while keeping the topic UI independent of live QBReader.
    await page.route("**/api/practice/questions", async (route) => {
      expect(route.request().postDataJSON().topic).toBe("biology");
      await route.fulfill({ json: { questions: [question], sessionId } });
    });
    await page.goto("/decks");
    await expect(
      page.getByRole("heading", { name: "Starred Questions" }),
    ).toBeVisible();
    await page.getByLabel("Deck name", { exact: true }).fill("Biology topics");
    await page.getByLabel("Topic tags", { exact: true }).fill("biology, cells");
    await page.getByLabel("Populate from a topic").fill("biology");
    await page.getByLabel("Question type").selectOption("bonus");
    await page
      .getByRole("button", { name: "Create deck", exact: true })
      .click();
    await expect(
      page.getByText("Deck created with 1 original questions."),
    ).toBeVisible();
    let deck = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("heading", { name: "Biology topics", exact: true }),
    });
    await expect(deck).toContainText("1 saved questions");
    await deck.getByText("Export to Anki", { exact: true }).click();
    await deck.getByLabel("Export difficulty").selectOption("0");
    await expect(
      deck.getByRole("button", { name: "Download Anki CSV" }),
    ).toBeDisabled();
    await deck.getByLabel("Export difficulty").selectOption("4");
    const downloadPromise = page.waitForEvent("download");
    await deck.getByRole("button", { name: "Download Anki CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("Biology topics-questions.csv");
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream!) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString("utf8");
    expect(csv).toContain("#html:true");
    expect(csv).toContain(
      "Name the powerhouse.<br><br>Name the photosynthesis organelle.",
    );
    expect(csv).toContain("<b>mitochondria</b>");
    expect(csv).toContain("Deck test packet");
    expect(csv).toContain("topic::biology");
    expect(csv).toContain("#guid column:5");
    const packageDownload = page.waitForEvent("download");
    await deck
      .getByRole("button", { name: "Download Anki package", exact: true })
      .click();
    const apkg = await packageDownload;
    expect(apkg.suggestedFilename()).toBe("Biology topics-questions.apkg");
    const packageStream = await apkg.createReadStream();
    const packageChunks = [];
    for await (const chunk of packageStream!) packageChunks.push(chunk);
    const archive = unzipSync(Buffer.concat(packageChunks));
    expect(
      Buffer.from(archive["collection.anki2"]).subarray(0, 16).toString(),
    ).toBe("SQLite format 3\x00");
    await deck.getByLabel("Export card type").selectOption("identifiers");
    await expect(deck.getByLabel("Clue complexity")).toBeVisible();
    await expect(
      deck.getByRole("button", { name: "Download Anki CSV" }),
    ).toBeDisabled();
    const importedDeck = (
      await db.collection(`users/${user.uid}/decks`).get()
    ).docs.find((doc) => doc.data().name === "Biology topics")!;
    const importedCard = (await importedDeck.ref.collection("questions").get())
      .docs[0];
    await importedCard.ref.update({
      identifiers: [
        {
          id: "biology-identifier",
          clue: "Which organelle powers the cell?",
          complexity: "simple",
          part: 0,
          sourceExcerpt: "Name the powerhouse.",
        },
      ],
    });
    await page
      .getByRole("button", { name: "Refresh decks", exact: true })
      .click();
    await expect(deck.getByRole("status")).toContainText("1 cards match");
    await deck.getByLabel("Clue complexity").selectOption("complex");
    await expect(
      deck.getByRole("button", { name: "Download Anki package", exact: true }),
    ).toBeDisabled();
    await deck.getByLabel("Clue complexity").selectOption("simple");
    const identifierDownload = page.waitForEvent("download");
    await deck
      .getByRole("button", { name: "Download Anki package", exact: true })
      .click();
    const identifierPackage = await identifierDownload;
    const identifierStream = await identifierPackage.createReadStream();
    const identifierChunks = [];
    for await (const chunk of identifierStream!) identifierChunks.push(chunk);
    const identifierDatabase = Buffer.from(
      unzipSync(Buffer.concat(identifierChunks))["collection.anki2"],
    ).toString();
    expect(identifierDatabase).toContain("Which organelle powers the cell?");
    expect(identifierDatabase).toContain("<b>mitochondria</b>");
    await deck
      .getByRole("button", { name: "Study flashcards", exact: true })
      .click();
    const flashcards = deck.getByRole("region", {
      name: "Full-question flashcards",
    });
    await expect(flashcards).toContainText(
      "Name the photosynthesis organelle.",
    );
    await expect(flashcards).not.toContainText("chloroplast");
    await flashcards.getByRole("button", { name: "Flip to answer" }).click();
    await expect(flashcards).toContainText("mitochondria");
    await expect(flashcards).toContainText("chloroplast");
    await deck.getByRole("button", { name: "Close flashcards" }).click();
    await deck.getByRole("button", { name: "Edit deck", exact: true }).click();
    await deck.getByLabel("Deck name", { exact: true }).fill("Cell review");
    await deck.getByLabel("Deck description").fill("Full bonus practice");
    await deck.getByRole("button", { name: "Save deck changes" }).click();
    deck = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("heading", { name: "Cell review", exact: true }),
    });
    await expect(deck).toContainText("Full bonus practice");
    await deck.locator("summary").filter({ hasText: "Difficulty 4" }).click();
    await deck.getByRole("button", { name: "Edit card", exact: true }).click();
    await deck.getByLabel("Question part 1").fill("Edited clue for review");
    await deck.getByLabel("Answer part 1").fill("Edited study answer");
    await deck.getByLabel("Card topic tags").fill("organelles");
    await deck.getByLabel("Study notes").fill("Study this tomorrow");
    await deck.getByRole("button", { name: "Save card changes" }).click();
    await expect(deck).toContainText("Edited clue for review");
    await deck
      .getByText("Original QBReader question and official answer lines", {
        exact: true,
      })
      .click();
    await expect(deck).toContainText("Name the powerhouse.");
    await page.getByLabel("Search saved cards").fill("organelles");
    await expect(deck).toContainText("1 matching");
    await page.getByLabel("Search saved cards").fill("no such clue");
    await expect(deck).toContainText("No cards match your search.");
    await page.getByLabel("Search saved cards").fill("");
    await page.getByLabel("Deck name", { exact: true }).fill("Second deck");
    await page
      .getByRole("button", { name: "Create deck", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Second deck", exact: true }),
    ).toBeVisible();
    await deck.locator("summary").filter({ hasText: "Difficulty 4" }).click();
    await deck
      .getByRole("button", { name: "Add to deck", exact: true })
      .click();
    await deck
      .getByRole("checkbox", { name: "Starred Questions", exact: true })
      .check();
    await deck
      .getByRole("checkbox", { name: "Second deck", exact: true })
      .check();
    await deck
      .getByRole("button", { name: "Save question", exact: true })
      .click();
    await expect(deck.getByText("Question saved to your deck.")).toBeVisible();
    await page.getByRole("button", { name: "Refresh decks" }).click();
    const starred = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("heading", {
        name: "Starred Questions",
        exact: true,
      }),
    });
    await expect(starred).toContainText("1 saved questions");
    await page.unroute("**/api/practice/questions");
    await page.route("**/api/practice/questions", (route) =>
      route.fulfill({ json: { questions: [question], sessionId } }),
    );
    await page.goto("/practice");
    await page
      .getByRole("button", { name: "Start session", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Star question", exact: true })
      .click();
    await expect(page.getByText("Saved to Starred Questions.")).toBeVisible();
    // Repeated starring must not duplicate the saved question.
    expect(
      (await db.collection(`users/${user.uid}/decks/starred/questions`).get())
        .size,
    ).toBe(1);
    const decks = await db.collection(`users/${user.uid}/decks`).get();
    const cell = decks.docs.find((doc) => doc.data().name === "Cell review")!;
    const card = (await cell.ref.collection("questions").get()).docs[0];
    expect(card.data().originalQuestion).toEqual(question);
    expect(card.data().question.parts[0]).toBe("Edited clue for review");
    const login = await fetch(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          password: "quizbowl-test-123",
          returnSecureToken: true,
        }),
      },
    );
    const { idToken } = await login.json();
    const headers = { Authorization: `Bearer ${idToken}` };
    expect(
      (
        await page.request.post("/api/decks/export", {
          data: { deckId: cell.id },
        })
      ).status(),
    ).toBe(401);
    for (const options of [
      { difficulty: 0 },
      { difficulty: "11" },
      { complexity: "invalid" },
    ]) {
      expect(
        (
          await page.request.post("/api/decks/export", {
            headers,
            data: { deckId: cell.id, options },
          })
        ).status(),
      ).toBe(400);
    }
    const noMatches = await page.request.post("/api/decks/export", {
      headers,
      data: { deckId: cell.id, options: { difficulty: "0" } },
    });
    expect(noMatches.status()).toBe(400);
    const outsider = `other-${user.uid}`;
    await db
      .doc(`users/${outsider}/decks/foreign-deck`)
      .set({ name: "Foreign deck" });
    try {
      const foreignExport = await page.request.post("/api/decks/export", {
        headers,
        data: { deckId: "foreign-deck", uid: outsider },
      });
      expect(foreignExport.status()).toBe(404);
      for (const action of ["update", "delete", "editCard", "removeCard"]) {
        const response = await page.request.post("/api/decks", {
          headers,
          data: {
            action,
            uid: outsider,
            deckId: "foreign-deck",
            name: "Forged name",
            cardId: "foreign-card",
          },
        });
        expect(response.status()).toBe(404);
      }
      expect(
        (await db.doc(`users/${outsider}/decks/foreign-deck`).get()).data()!
          .name,
      ).toBe("Foreign deck");
      const invalid = await page.request.post("/api/decks", {
        headers,
        data: { action: "create", name: "Invalid", tags: [42] },
      });
      expect(invalid.status()).toBe(400);
      const atomic = await page.request.post("/api/decks", {
        headers,
        data: {
          action: "save",
          sessionId,
          questionIndexes: [0],
          deckIds: [cell.id, "missing"],
        },
      });
      expect(atomic.status()).toBe(404);
      const protectedDeck = await page.request.post("/api/decks", {
        headers,
        data: { action: "delete", deckId: "starred" },
      });
      expect(protectedDeck.status()).toBe(400);
    } finally {
      await db.recursiveDelete(db.doc(`users/${outsider}`));
    }
    await page.goto("/decks");
    const second = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("heading", { name: "Second deck", exact: true }),
    });
    await expect(second).toContainText("1 saved questions");
    await second.locator("summary").filter({ hasText: "Difficulty 4" }).click();
    await second
      .getByRole("button", { name: "Remove card", exact: true })
      .click();
    await second.getByRole("button", { name: "Confirm remove card" }).click();
    await expect(second).toContainText("0 saved questions");
    await second
      .getByRole("button", { name: "Delete deck", exact: true })
      .click();
    await second.getByRole("button", { name: "Confirm delete deck" }).click();
    await expect(
      page.getByRole("heading", { name: "Second deck", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("study-decks.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await db.recursiveDelete(db.doc(`users/${user.uid}`));
    await db.doc(`teams/team-e2e/members/${user.uid}`).delete();
    await auth.deleteUser(user.uid);
  }
});

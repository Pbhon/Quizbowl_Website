import { test, expect } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
const enabled = process.env.E2E_FIREBASE === "true";
if (enabled) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}
function services() {
  const app =
    getApps().find((a) => a.name === "backend-browser") ||
    initializeApp({ projectId: "demo-quizbowl" }, "backend-browser");
  return { auth: getAuth(app), db: getFirestore(app) };
}
test("settings download only owner data and queue an explicitly confirmed self deletion", async ({
  page,
}, testInfo) => {
  test.skip(!enabled, "Requires demo Firebase emulators");
  const { auth, db } = services();
  const password = "backend-test-password-123";
  const user = await auth.createUser({
    email: `privacy-${crypto.randomUUID()}@example.com`,
    password,
    emailVerified: true,
  });
  const other = "other-" + crypto.randomUUID();
  try {
    await db
      .doc(`users/${user.uid}/decks/private/questions/card`)
      .set({ question: "Owner-only export content" });
    await db.doc(`users/${other}`).set({ bio: "Other student's secret" });
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(user.email!);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByText("You’re signed in", { exact: true }),
    ).toBeVisible();
    await page.goto("/settings");
    await expect(
      page.getByText("Privacy and your data", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("settings-privacy.png"),
      fullPage: true,
    });
    await page.getByLabel("Current password for data requests").fill(password);
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download my data", exact: true })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("quizbowl-account-data.json");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("Owner-only export content");
    expect(text).not.toContain("Other student's secret");
    expect(JSON.parse(text).account.uid).toBe(user.uid);
    await page
      .getByRole("button", { name: "Request account deletion", exact: true })
      .click();
    expect((await db.doc(`privacyJobs/${user.uid}`).get()).exists).toBe(false);
    await page.getByLabel("Current password for data requests").fill(password);
    const deletionResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/account/data") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Confirm deletion request", exact: true })
      .click();
    expect((await deletionResponse).status()).toBe(202);
    await expect(
      page.getByText(
        /Deletion requested\. Your school operator must process it/,
      ),
    ).toBeVisible();
    expect((await db.doc(`privacyJobs/${user.uid}`).get()).data()?.status).toBe(
      "requested",
    );
    expect((await auth.getUser(user.uid)).disabled).toBe(false);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await db.recursiveDelete(db.doc(`users/${user.uid}`));
    await db.recursiveDelete(db.doc(`users/${other}`));
    await db.doc(`teams/team-e2e/members/${user.uid}`).delete();
    await db.doc(`privacyJobs/${user.uid}`).delete();
    await auth.deleteUser(user.uid);
  }
});
test("API proxy rejects invalid tokens, oversized streams and export bursts with private responses", async ({
  request,
}) => {
  test.skip(!enabled, "Requires demo Firebase emulators");
  const { auth, db } = services();
  const password = "backend-test-password-123";
  const user = await auth.createUser({
    email: `limits-${crypto.randomUUID()}@example.com`,
    password,
    emailVerified: true,
  });
  try {
    const login = await request.post(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
      { data: { email: user.email, password, returnSecureToken: true } },
    );
    const token = (await login.json()).idToken;
    const headers = { Authorization: `Bearer ${token}` };
    const invalid = await request.get("/api/history", {
      headers: { Authorization: "Bearer fake" },
    });
    expect(invalid.status()).toBe(401);
    expect(invalid.headers()["cache-control"]).toContain("no-store");
    const oversized = await request.post("/api/decks/export", {
      headers,
      data: "x".repeat(2 * 1024 * 1024 + 1),
    });
    expect(oversized.status()).toBe(413);
    const selector = await request.get("/api/account/data?uid=victim", {
      headers,
    });
    expect(selector.status()).toBe(400);
    const forged = await request.post("/api/account/data", {
      headers,
      data: { action: "request-deletion", uid: "victim" },
    });
    expect(forged.status()).toBe(400);
    expect((await db.doc("privacyJobs/victim").get()).exists).toBe(false);
    for (let i = 0; i < 6; i++)
      expect(
        (
          await request.post("/api/decks/export", { headers, data: {} })
        ).status(),
      ).toBe(400);
    const limited = await request.post("/api/decks/export", {
      headers,
      data: {},
    });
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
  } finally {
    await db.recursiveDelete(db.doc(`users/${user.uid}`));
    await auth.deleteUser(user.uid);
  }
});

import { test, expect } from "@playwright/test";

test("workspace navigation works and fits the viewport", async ({
  page,
  isMobile,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Curiosity",
  );
  if (isMobile) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(
      page.getByRole("button", { name: "Close navigation" }),
    ).toHaveAttribute("aria-expanded", "true");
  }
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Practice", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Practice");
  if (isMobile) await expect(page.getByRole("navigation")).toBeHidden();
  for (const [route, title] of [
    ["decks", "Study decks"],
    ["calendar", "Team calendar"],
  ]) {
    await page.goto(`/${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  }
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("workspace.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("missing Firebase configuration disables authentication clearly", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_FIREBASE === "true",
    "Uses the unconfigured environment",
  );
  await page.goto("/login");
  await expect(page.getByRole("status")).toContainText(
    "waiting for Firebase configuration",
  );
  await expect(page.getByLabel("Email", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toBeDisabled();
});

test("Firebase registration, session restoration and sign-in work", async ({
  page,
  request,
}, info) => {
  test.skip(
    process.env.E2E_FIREBASE !== "true",
    "Requires local Firebase emulators",
  );
  const email = `student-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/login");
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Test Student");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("quizbowl-test-123");
  const registration = page.waitForResponse(
    (response) => response.url().includes("accounts:signUp") && response.ok(),
  );
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByText("You’re signed in", { exact: true }),
  ).toBeVisible();
  // Verify the real profile write completes before reloading the page.
  const account = await (await registration).json();
  expect(account.localId).toBeTruthy();
  await expect
    .poll(async () => {
      const response = await request.get(
        `http://127.0.0.1:8080/v1/projects/demo-quizbowl/databases/(default)/documents/users/${account.localId}`,
        { headers: { Authorization: `Bearer ${account.idToken}` } },
      );
      const body = await response.json();
      return body.fields?.displayName?.stringValue;
    })
    .toBe("Test Student");
  await expect
    .poll(async () => {
      const response = await request.get(
        "http://127.0.0.1:8080/v1/projects/demo-quizbowl/databases/(default)/documents/teams/team-e2e/members/" +
          account.localId,
        { headers: { Authorization: "Bearer " + account.idToken } },
      );
      return (await response.json()).fields?.displayName?.stringValue;
    })
    .toBe("Test Student");
  await page.reload();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New here? Create an account" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await page.goto("/");
  await expect(
    page
      .getByRole("main")
      .getByRole("link", { name: "Explore practice", exact: true })
      .first(),
  ).toHaveAttribute("href", "/practice");
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
  await page.goto("/login");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("quizbowl-test-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("You’re signed in", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

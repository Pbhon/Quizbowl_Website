import { test, expect, type Page } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const firebase = process.env.E2E_FIREBASE === "true";
const signupCode = "test-admin-code-only-local-123456789";
if (firebase) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}
function services() {
  const app =
    getApps().find((app) => app.name === "e2e") ||
    initializeApp(
      {
        projectId: "demo-quizbowl",
      },
      "e2e",
    );
  return { auth: getAuth(app), db: getFirestore(app) };
}
async function fixture(role: "student" | "teacher" | "admin", prefix: string) {
  const { auth, db } = services();
  const email = prefix + "-" + crypto.randomUUID() + "@example.com";
  const user = await auth.createUser({
    email,
    password: "quizbowl-test-123",
    displayName: "Test " + role,
    emailVerified: true,
  });
  if (role !== "student")
    await db.doc("staff/" + user.uid).set({ role, teamId: "team-e2e" });
  return user;
}
async function signIn(
  page: Page,
  email: string,
  password = "quizbowl-test-123",
) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("You’re signed in", { exact: true }),
  ).toBeVisible();
}

test("private pages require sign-in and invalid section names return 404", async ({
  page,
}) => {
  for (const path of ["/profile", "/settings", "/team"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Sign in to continue" }),
    ).toBeVisible();
  }
  const response = await page.goto("/constructor");
  expect(response?.status()).toBe(404);
});

test("admin signup fails closed when its private code is not configured", async ({
  request,
}) => {
  test.skip(firebase, "Uses the unconfigured environment");
  const response = await request.post("/api/auth/admin-register", {
    data: {
      name: "Admin",
      email: "admin@example.com",
      password: "quizbowl-test-123",
      code: "any-code",
    },
  });
  expect(response.status()).toBe(503);
  expect((await response.json()).message).toContain("not configured");
});

test("student profiles, preferences and password changes persist", async ({
  page,
  isMobile,
}, info) => {
  test.skip(!firebase, "Requires Firebase emulators");
  const user = await fixture("student", info.project.name);
  await signIn(page, user.email!);
  await page.goto("/profile");
  await page.getByLabel("Display name", { exact: true }).fill("Ada Student");
  await page.getByLabel("Grade / level").selectOption("10");
  await page.getByLabel("About you").fill("Science and literature");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(
    "Profile saved.",
  );
  await page.reload();
  await expect(page.getByLabel("Display name")).toHaveValue("Ada Student");
  await expect(page.getByLabel("About you")).toHaveValue(
    "Science and literature",
  );
  if (!isMobile)
    await expect(
      page.locator("header").getByRole("link", { name: "Ada Student" }),
    ).toHaveCount(1);

  await page.goto("/settings");
  await page.getByLabel("Appearance").selectOption("dark");
  await page.getByLabel("Reduce motion").check();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "Preferences saved.",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await page.screenshot({
    path: info.outputPath("settings-dark.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await page
    .getByLabel("Current password", { exact: true })
    .fill("wrong-password");
  await page
    .getByLabel("New password", { exact: true })
    .fill("changed-password-123");
  await page.getByLabel("Confirm new password").fill("different-password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "don’t match",
  );
  await page.getByLabel("Confirm new password").fill("changed-password-123");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "incorrect",
  );
  await page
    .getByLabel("Current password", { exact: true })
    .fill("quizbowl-test-123");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(
    page.getByText("Password updated.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, user.email!, "changed-password-123");
  await page.goto("/team");
  await expect(
    page.getByRole("heading", { name: "Staff access required" }),
  ).toBeVisible();
});

test("teacher login sees the school roster", async ({ page }, info) => {
  test.skip(!firebase, "Requires Firebase emulators");
  const user = await fixture("teacher", info.project.name);
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Teacher / Admin", exact: true })
    .click();
  await page.getByLabel("Email", { exact: true }).fill(user.email!);
  await page.getByLabel("Password", { exact: true }).fill("quizbowl-test-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Open team access" }),
  ).toBeVisible();
  await page.goto("/team");
  await expect(
    page.getByRole("heading", { name: /^Team members \(\d+\)$/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Student email")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("team-roster.png"),
    fullPage: true,
  });
  await services()
    .db.doc("staff/" + user.uid)
    .update({ teamId: "other-school" });
  await expect(
    page.getByRole("heading", { name: "Staff access required" }),
  ).toBeVisible();
});

test("sign-in joins this school automatically and cannot select another team", async ({
  page,
  request,
}, info) => {
  test.skip(!firebase, "Requires Firebase emulators");
  const student = await fixture("student", info.project.name);
  const { auth, db } = services();
  await auth.updateUser(student.uid, { emailVerified: false });
  await db.doc("teams/other-school/members/" + student.uid).set({
    displayName: "Other school name",
    joinedAt: new Date(0),
    updatedAt: new Date(0),
  });
  await signIn(page, student.email!);
  await page.goto("/profile");
  await expect(
    page.getByText("Connected to Test High School", { exact: true }),
  ).toBeVisible();
  const member = db.doc("teams/team-e2e/members/" + student.uid);
  const first = (await member.get()).data()!;
  expect(first.displayName).toBe("Test student");
  await page.reload();
  await expect(page.getByLabel("Display name")).toBeVisible();
  expect((await member.get()).data()!.joinedAt.toMillis()).toBe(
    first.joinedAt.toMillis(),
  );
  expect(
    (await db.doc("teams/other-school/members/" + student.uid).get()).data()!
      .displayName,
  ).toBe("Other school name");
  expect((await request.post("/api/auth/team-session")).status()).toBe(401);
  expect(
    (
      await request.post("/api/auth/team-session", {
        headers: { Authorization: "Bearer invalid" },
      })
    ).status(),
  ).toBe(401);
  const tokenReply = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
    {
      data: {
        email: student.email,
        password: "quizbowl-test-123",
        returnSecureToken: true,
      },
    },
  );
  const { idToken } = await tokenReply.json();
  const headers = { Authorization: "Bearer " + idToken };
  const responses = await Promise.all(
    [1, 2].map(() =>
      request.post("/api/auth/team-session", {
        headers,
        data: { teamId: "forged-school", role: "admin" },
      }),
    ),
  );
  for (const response of responses) {
    expect(response.status()).toBe(200);
    expect((await response.json()).teamId).toBe("team-e2e");
  }
  expect(
    (await db.doc("teams/forged-school/members/" + student.uid).get()).exists,
  ).toBe(false);
  expect((await db.doc("staff/" + student.uid).get()).exists).toBe(false);
  expect(
    (
      await request.post("/api/auth/team-session", {
        headers: { ...headers, Origin: "https://untrusted.example" },
      })
    ).status(),
  ).toBe(403);
  await auth.updateUser(student.uid, { disabled: true });
  expect(
    (await request.post("/api/auth/team-session", { headers })).status(),
  ).toBe(401);
});

test("admin signup rejects incorrect codes and creates staff only after a valid code", async ({
  page,
  request,
}, info) => {
  test.skip(!firebase, "Requires Firebase emulators");
  const { auth, db } = services();
  const email =
    "new-admin-" +
    info.project.name +
    "-" +
    crypto.randomUUID() +
    "@example.com";
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Teacher / Admin", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create an admin account", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("New Admin");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("quizbowl-test-123");
  await page.getByLabel("Administrator code").fill("incorrect");
  await page
    .getByRole("button", { name: "Create admin account", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "code is incorrect",
  );
  await expect(auth.getUserByEmail(email)).rejects.toMatchObject({
    code: "auth/user-not-found",
  });
  await page.getByLabel("Administrator code").fill(signupCode);
  await page
    .getByRole("button", { name: "Create admin account", exact: true })
    .click();
  await expect(
    page.getByText("You’re signed in", { exact: true }),
  ).toBeVisible();
  const account = await auth.getUserByEmail(email);
  expect((await db.doc("staff/" + account.uid).get()).data()).toEqual({
    role: "admin",
    teamId: "team-e2e",
  });
  await page.goto("/team");
  await expect(
    page.getByRole("button", { name: "Refresh verification" }),
  ).toBeVisible();
  await auth.updateUser(account.uid, { emailVerified: true });
  await page.getByRole("button", { name: "Refresh verification" }).click();
  await expect(
    page.getByRole("heading", { name: /^Team members \(\d+\)$/ }),
  ).toBeVisible();

  const payload = {
    email,
    password: "quizbowl-test-123",
    name: "Admin",
    code: signupCode,
  };
  expect(
    (
      await request.post("/api/auth/admin-register", {
        data: { ...payload, code: "bad" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/auth/admin-register", {
        data: { ...payload, name: " " },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/auth/admin-register", {
        data: payload,
        headers: { Origin: "https://untrusted.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/auth/admin-register", {
        data: { ...payload, name: "x".repeat(9000) },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/auth/admin-register", { data: payload })
    ).status(),
  ).toBe(409);
  await db
    .doc("adminSignupLimits/team-e2e")
    .set({ count: 10, windowEnd: Date.now() + 3600000 });
  expect(
    (
      await request.post("/api/auth/admin-register", {
        data: { ...payload, email: "limited@example.com" },
      })
    ).status(),
  ).toBe(429);
  await db.doc("adminSignupLimits/team-e2e").delete();
});

test("password reset gives a private confirmation and sends a reset link", async ({
  page,
  request,
}, info) => {
  test.skip(!firebase, "Requires Firebase emulators");
  const account = await fixture("student", info.project.name);
  await page.goto("/login");
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await page.getByLabel("Email", { exact: true }).fill(account.email!);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "If an account exists",
  );
  const response = await request.get(
    "http://127.0.0.1:9099/emulator/v1/projects/demo-quizbowl/oobCodes",
  );
  const codes = (await response.json()).oobCodes;
  expect(
    codes.some(
      (code: { email: string; requestType: string }) =>
        code.email === account.email && code.requestType === "PASSWORD_RESET",
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

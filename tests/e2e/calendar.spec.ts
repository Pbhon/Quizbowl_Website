import { test, expect, type Page } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
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
test("calendar authoring, student visibility, deadlines, RSVPs, announcements and export", async ({
  page,
  request,
}, info) => {
  test.skip(!enabled, "Requires Firebase emulators");
  test.setTimeout(120000);
  const app =
    getApps().find((app) => app.name === "calendar-tests") ||
    initializeApp({ projectId: "demo-quizbowl" }, "calendar-tests");
  const auth = getAuth(app),
    db = getFirestore(app),
    users: UserRecord[] = [];
  const ids: { collection: string; id: string }[] = [];
  const marker = crypto.randomUUID().slice(0, 8),
    title = `Tournament ${marker}`,
    deadline = `Deadline ${marker}`;
  try {
    for (const name of ["Admin", "Student", "Teacher", "Outsider"]) {
      const user = await auth.createUser({
        email: `calendar-${crypto.randomUUID()}@example.com`,
        password: "quizbowl-test-123",
        emailVerified: true,
        displayName: name,
      });
      users.push(user);
      if (name !== "Outsider")
        await db
          .doc(`teams/team-e2e/members/${user.uid}`)
          .set({ displayName: name });
    }
    const [admin, student, teacher, outsider] = users;
    await db
      .doc(`staff/${admin.uid}`)
      .set({ role: "admin", teamId: "team-e2e" });
    await db
      .doc(`staff/${teacher.uid}`)
      .set({ role: "teacher", teamId: "team-e2e" });
    async function headers(user: UserRecord) {
      const response = await request.post(
        "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
        {
          data: {
            email: user.email,
            password: "quizbowl-test-123",
            returnSecureToken: true,
          },
        },
      );
      expect(response.ok()).toBeTruthy();
      return { Authorization: `Bearer ${(await response.json()).idToken}` };
    }
    const adminHeaders = await headers(admin),
      studentHeaders = await headers(student),
      teacherHeaders = await headers(teacher),
      outsiderHeaders = await headers(outsider);
    expect((await request.get("/api/calendar")).status()).toBe(401);
    expect(
      (
        await request.get("/api/calendar", { headers: outsiderHeaders })
      ).status(),
    ).toBe(403);
    const base = {
      action: "create",
      title,
      startsAt: "2099-11-01T18:00:00.000Z",
      published: true,
      type: "competition",
      rsvpEnabled: true,
    };
    expect(
      (
        await request.post("/api/calendar", {
          headers: studentHeaders,
          data: base,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.post("/api/calendar", {
          headers: teacherHeaders,
          data: base,
        })
      ).status(),
    ).toBe(403);
    await signIn(page, admin.email!);
    await page.goto("/calendar");
    await page.getByLabel("Event title", { exact: true }).fill(title);
    await page
      .getByLabel("Event type", { exact: true })
      .selectOption("competition");
    await page
      .getByLabel("Starts at", { exact: true })
      .fill("2099-11-01T14:00");
    await page
      .getByLabel("Ends at (optional)", { exact: true })
      .fill("2099-11-01T16:00");
    await page.getByLabel("Location", { exact: true }).fill("School gym");
    await page
      .getByLabel("Description", { exact: true })
      .fill("Meet by the entrance.");
    await page.getByLabel("Publish event", { exact: true }).check();
    await page.getByLabel("Allow optional RSVPs", { exact: true }).check();
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    const workspace = await (
      await request.get("/api/calendar", { headers: adminHeaders })
    ).json();
    const event = workspace.events.find(
      (event: { title: string }) => event.title === title,
    );
    expect(event).toBeTruthy();
    ids.push({ collection: "events", id: event.id });
    await page.getByRole("button", { name: "Edit event", exact: true }).click();
    await page.getByLabel("Location", { exact: true }).fill("Main auditorium");
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await expect(
      page.getByText("Location: Main auditorium", { exact: true }),
    ).toBeVisible();
    const draft = await (
      await request.post("/api/calendar", {
        headers: adminHeaders,
        data: { ...base, title: `Draft ${marker}`, published: false },
      })
    ).json();
    ids.push({ collection: "events", id: draft.eventId });
    const practice = await (
      await request.post("/api/calendar", {
        headers: adminHeaders,
        data: { ...base, title: `Practice ${marker}`, type: "practice" },
      })
    ).json();
    ids.push({ collection: "events", id: practice.eventId });
    const assignmentId = crypto.randomUUID();
    ids.push({ collection: "assignments", id: assignmentId });
    await db.doc(`teams/team-e2e/assignments/${assignmentId}`).set({
      title: deadline,
      published: true,
      audience: "students",
      studentUids: [student.uid],
      dueAt: "2099-11-02T18:00:00.000Z",
      questionCount: 10,
      type: "tossup",
    });
    await page
      .getByLabel("Announcement title", { exact: true })
      .fill(`Travel ${marker}`);
    await page
      .getByLabel("Announcement message", { exact: true })
      .fill("Bring lunch.");
    await page.getByLabel("Publish announcement", { exact: true }).check();
    await page
      .getByRole("button", { name: "Save announcement", exact: true })
      .click();
    await expect(page.getByText("Bring lunch.", { exact: true })).toBeVisible();
    const announcement = (
      await (
        await request.get("/api/calendar", { headers: adminHeaders })
      ).json()
    ).announcements.find(
      (item: { title: string }) => item.title === `Travel ${marker}`,
    );
    ids.push({ collection: "announcements", id: announcement.id });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await signIn(page, student.email!);
    await page.goto("/calendar");
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: deadline, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: `Draft ${marker}`, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save event", exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel(`RSVP for ${title}`, { exact: true })
      .selectOption("going");
    await expect(
      page.getByLabel(`RSVP for ${title}`, { exact: true }),
    ).toHaveValue("going");
    expect(
      (
        await db
          .doc(`teams/team-e2e/events/${event.id}/rsvps/${student.uid}`)
          .get()
      ).data()?.response,
    ).toBe("going");
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export calendar (.ics)", exact: true })
      .click();
    expect((await download).suggestedFilename()).toBe("quizbowl-team.ics");
    const exported = await request.get("/api/calendar?format=ics", {
      headers: studentHeaders,
    });
    expect(exported.headers()["cache-control"]).toBe("private, no-store");
    const ics = (await exported.text()).replace(/\r\n /g, "");
    expect(ics).toContain(title);
    expect(ics).toContain(deadline);
    expect(ics).not.toContain(`Draft ${marker}`);
    await page.screenshot({
      path: info.outputPath("calendar.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.goto("/dashboard");
    await expect(
      page.getByRole("link", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Bring lunch.", { exact: true })).toBeVisible();
    const ref = db.doc(`teams/team-e2e/events/${event.id}`);
    await ref.update({ published: false });
    expect(
      (
        await request.post("/api/calendar", {
          headers: studentHeaders,
          data: { action: "rsvp", id: event.id, response: "maybe" },
        })
      ).status(),
    ).toBe(409);
    await db.doc(`teams/team-e2e/members/${student.uid}`).delete();
    expect(
      (
        await request.get("/api/calendar?format=ics", {
          headers: studentHeaders,
        })
      ).status(),
    ).toBe(403);
  } finally {
    for (const item of ids)
      await db.recursiveDelete(
        db.doc(`teams/team-e2e/${item.collection}/${item.id}`),
      );
    for (const user of users) {
      await db.recursiveDelete(db.doc(`users/${user.uid}`));
      await db.doc(`staff/${user.uid}`).delete();
      await db.doc(`teams/team-e2e/members/${user.uid}`).delete();
      await auth.deleteUser(user.uid);
    }
  }
});

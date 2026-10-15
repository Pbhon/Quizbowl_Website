import { defineConfig, devices } from "@playwright/test";

const firebase = process.env.E2E_FIREBASE === "true";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  // A fresh CI runner compiles the auth routes and initializes Firebase on first sign-in.
  expect: { timeout: process.env.CI ? 20000 : 5000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.E2E_BROWSER_PATH },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_PUBLIC_FIREBASE_API_KEY: firebase ? "demo-api-key" : "",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: firebase
        ? "demo-quizbowl.firebaseapp.com"
        : "",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: firebase ? "demo-quizbowl" : "",
      NEXT_PUBLIC_FIREBASE_APP_ID: firebase ? "demo-app" : "",
      NEXT_PUBLIC_USE_FIREBASE_EMULATORS: firebase ? "true" : "false",
      ADMIN_SIGNUP_CODE: firebase ? "test-admin-code-only-local-123456789" : "",
      SITE_TEAM_ID: firebase ? "team-e2e" : "",
      NEXT_PUBLIC_TEAM_NAME: "Test High School",
      ADMIN_SIGNUP_TEAM_ID: firebase ? "team-e2e" : "",
      FIREBASE_ADMIN_PROJECT_ID: firebase ? "demo-quizbowl" : "",
    },
  },
});

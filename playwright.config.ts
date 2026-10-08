import { defineConfig, devices } from "@playwright/test";

const firebase = process.env.E2E_FIREBASE === "true";
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure", launchOptions: { executablePath: process.env.E2E_BROWSER_PATH } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1", url: "http://127.0.0.1:3000", reuseExistingServer: false, timeout: 120000,
    env: {
      NEXT_PUBLIC_FIREBASE_API_KEY: firebase ? "demo-api-key" : "",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: firebase ? "demo-quizbowl.firebaseapp.com" : "",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: firebase ? "demo-quizbowl" : "",
      NEXT_PUBLIC_FIREBASE_APP_ID: firebase ? "demo-app" : "",
      NEXT_PUBLIC_USE_FIREBASE_EMULATORS: firebase ? "true" : "false",
    },
  },
});

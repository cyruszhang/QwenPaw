import { defineConfig } from "@playwright/test";

// Smoke harness for the Creator panel: loads the built bundle in a mock
// console host (test/harness.html) and drives it with mocked
// /api/creator responses. Uses the Playwright-managed Chromium that is
// already cached on the machine — no extra download in normal runs.
export default defineConfig({
  testDir: "./test",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    headless: true,
    // The panel calls EventSource/fetch against this sentinel origin; the
    // tests intercept it with page.route. Nothing leaves the machine.
    baseURL: "https://mock.local",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import { defineConfig, devices } from "@playwright/test";

// Tests that set up data directly (DATABASE_URL, Supabase keys) read .env.local
// like vitest.config.mts does. Variables already set (e.g. by CI) win.
if (existsSync(".env.local")) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(".env.local", "utf8")))) {
    process.env[key] ??= value;
  }
}

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;
/** Where tests/support/embed-host.mjs serves the sample website (another origin). */
const EMBED_HOST_PORT = 3200;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // Sign-up flows wait for real emails (Mailpit) and run axe on several pages.
  timeout: 60_000,
  // Locally the dev server compiles routes and server actions on first use,
  // which can take several seconds under parallel tests.
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The booking flow is mobile first (390 px mockups).
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    ...(process.env.PLAYWRIGHT_BASE_URL
      ? []
      : [
          {
            command: process.env.CI ? `pnpm start --port ${PORT}` : `pnpm dev --port ${PORT}`,
            url: baseURL,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            // The scripted AI receptionist: no keys, no network (env.ts refuses it in production).
            env: { AI_PROVIDER: "mock", AI_DAILY_MODEL_CALL_CAP: "100000" },
          },
        ]),
    // A plain "customer website" on another origin, for the widget (tests/e2e/embed.spec.ts).
    {
      command: "node tests/support/embed-host.mjs",
      url: `http://localhost:${EMBED_HOST_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: { EMBED_APP_URL: baseURL, EMBED_HOST_PORT: String(EMBED_HOST_PORT) },
    },
  ],
});

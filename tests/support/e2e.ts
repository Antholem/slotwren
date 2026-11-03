import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

import { waitForSignInLink } from "./mailpit";

/** Console errors, warnings and uncaught exceptions seen by `page`. */
export function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

export async function expectNoAxeViolations(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(axe.violations).toEqual([]);
}

export const uniqueEmail = (label: string) =>
  `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/**
 * The email links to the Supabase Site URL (localhost:3000). Follow it by path
 * so the tests also work against a server on another port.
 */
export function onThisServer(link: string) {
  const url = new URL(link);
  return url.pathname + url.search;
}

/** Request a magic link for `email` and follow it from Mailpit. */
export async function signInWithMagicLink(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  // Sending goes through Auth and SMTP; allow more than the default 5 s.
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused({
    timeout: 15_000,
  });
  const link = await waitForSignInLink(email);
  await page.goto(onThisServer(link));
  return link;
}

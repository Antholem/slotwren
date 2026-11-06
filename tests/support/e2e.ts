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
  // Judge the settled UI: a toast or sheet mid-fade has text at partial opacity.
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, {
      timeout: 5_000,
    })
    .catch(() => {}); // an endless animation (spinner) shouldn't block the scan
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

/**
 * Request a magic link for `email` and follow it from Mailpit. Pass
 * `{ onCurrentPage: true }` when already on a sign-in page that carries a
 * `next` (e.g. from an invite), so the return path is kept.
 */
export async function signInWithMagicLink(
  page: Page,
  email: string,
  { onCurrentPage = false }: { onCurrentPage?: boolean } = {},
) {
  if (!onCurrentPage) await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  const send = page.getByRole("button", { name: "Email me a sign-in link" });
  await send.click();
  // Sending goes through Auth and SMTP; allow more than the default 5 s. On a
  // loaded local Docker stack Auth sometimes times out (504) sending the email;
  // the form says so and a second try goes through. Sign-in has its own spec.
  const sent = page.getByRole("heading", { name: "Check your email" });
  const failed = page.getByText("We couldn't send your sign-in link");
  await expect(sent.or(failed)).toBeVisible({ timeout: 20_000 });
  if (await failed.isVisible()) await send.click();
  await expect(sent).toBeFocused({ timeout: 20_000 });
  const link = await waitForSignInLink(email);
  await page.goto(onThisServer(link));
  return link;
}

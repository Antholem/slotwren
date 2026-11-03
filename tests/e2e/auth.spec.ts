import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForSignInLink } from "../support/mailpit";

// Needs the local Supabase stack (Auth + Mailpit): `pnpm db:start`.

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectNoAxeViolations(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(axe.violations).toEqual([]);
}

const uniqueEmail = (label: string) =>
  `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

test("signed-out visitors to /app are sent to sign-in", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to Slotwren" })).toBeVisible();
  // Google isn't configured on the local stack, so its button stays hidden.
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);

  await expectNoAxeViolations(page);
  expect(errors).toEqual([]);
});

test("an invalid email is explained next to the field", async ({ page }) => {
  await page.goto("/sign-in");
  const email = page.getByLabel("Email");
  await email.fill("not-an-email");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();

  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveValue("not-an-email");
});

test("sign in by magic link, reach onboarding, sign out", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  const address = uniqueEmail("signin");

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(address);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();

  // Sending goes through Auth and SMTP; allow more than the default 5 s.
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused({
    timeout: 15_000,
  });
  await expect(page.getByText(address)).toBeVisible();

  // A brand-new user has no business yet: callback → /app → /onboarding.
  const link = await waitForSignInLink(address);
  await page.goto(link);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Let’s set up your business" }),
  ).toBeVisible();
  await expect(page.getByText(`Signed in as ${address}`)).toBeVisible();
  await expectNoAxeViolations(page);

  // Signed in, /sign-in bounces back into the app.
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in\?signed_out=1$/);
  await expect(page.getByRole("status")).toHaveText("You've signed out.");

  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fonboarding$/);

  // The link worked once; using it again explains what happened.
  await page.goto(link);
  await expect(page).toHaveURL(/\/sign-in\?error=link$/);
  await expect(
    page.getByRole("alert").filter({ hasText: "expired or was already used" }),
  ).toBeVisible();

  expect(errors).toEqual([]);
});

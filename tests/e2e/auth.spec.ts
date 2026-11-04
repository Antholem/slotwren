import { expect, test } from "@playwright/test";

import {
  collectConsoleErrors,
  expectNoAxeViolations,
  onThisServer,
  uniqueEmail,
} from "../support/e2e";
import { waitForSignInLink } from "../support/mailpit";

// Needs the local Supabase stack (Auth + Mailpit): `pnpm db:start`.

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

test("sign in by magic link, reach onboarding, leave", async ({ page }) => {
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

  // A brand-new user has no business yet: callback → /app → /onboarding → step 1.
  const link = await waitForSignInLink(address);
  await page.goto(onThisServer(link));
  await expect(page).toHaveURL(/\/onboarding\/basics$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Tell us about your business" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  // Signed in, /sign-in bounces back into the app (and on to the wizard).
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/onboarding\/basics$/);

  // The wizard's way out. An empty step 1 has nothing to save, so it just shows the saved screen.
  await expect(page.getByText("Detected")).toBeVisible({ timeout: 15_000 }); // hydrated
  await page.getByRole("button", { name: "Save and finish later" }).click();
  await expect(page).toHaveURL(/\/onboarding\/saved$/);
  await expect(page.getByRole("heading", { level: 1, name: "Nothing saved yet" })).toBeVisible();
  await expectNoAxeViolations(page);

  // Still signed in; signing out is a separate choice.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in\?signed_out=1$/);
  await expect(page.getByRole("status")).toHaveText("You've signed out.");

  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fonboarding$/);

  // The link worked once; using it again explains what happened.
  await page.goto(onThisServer(link));
  await expect(page).toHaveURL(/\/sign-in\?error=link$/);
  await expect(
    page.getByRole("alert").filter({ hasText: "expired or was already used" }),
  ).toBeVisible();

  expect(errors).toEqual([]);
});

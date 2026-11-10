import { expect, type Page, test } from "@playwright/test";

import {
  collectConsoleErrors,
  expectNoAxeViolations,
  signInWithMagicLink,
  uniqueEmail,
} from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

// Needs the local Supabase stack (Auth, Mailpit) and DATABASE_URL (.env.local).

const businesses = liveBusinesses();
test.afterAll(() => businesses.cleanup());

const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("follows the system, and every page stays readable (axe)", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);

    await page.goto("/sign-in");
    expect(await isDark(page)).toBe(true);
    await expectNoAxeViolations(page);

    // The wizard, before the business exists
    await businesses.signInWithBusiness(page, "owner", "dark");
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await isDark(page)).toBe(true);

    for (const path of [
      "/app",
      "/app/live",
      "/app/services",
      "/app/staff",
      "/app/settings",
      "/app/settings/booking-page",
      "/app/settings/embed",
      "/app/settings/notifications",
      "/app/settings/billing",
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoAxeViolations(page);
    }

    // Sheets and tabs
    await page.goto("/app/services");
    await page.getByRole("button", { name: "Edit Haircut" }).first().click();
    await expectNoAxeViolations(page);
    await page.keyboard.press("Escape");

    await page.goto("/app/staff");
    await page.getByRole("button", { name: "Edit Mia" }).click();
    await page.getByRole("dialog").getByRole("tab", { name: "Hours" }).click();
    await expectNoAxeViolations(page);
    await page.getByRole("dialog").getByRole("tab", { name: "Time off" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Add time off" }).click();
    await expectNoAxeViolations(page);
    expect(errors).toEqual([]);
  });

  test("onboarding is readable in dark too", async ({ page }) => {
    test.setTimeout(120_000);
    await signInWithMagicLink(page, uniqueEmail("dark-wizard"));
    await expect(page).toHaveURL(/\/onboarding\/basics$/);
    await expect(page.getByText("Detected")).toBeVisible({ timeout: 15_000 });
    expect(await isDark(page)).toBe(true);
    await expectNoAxeViolations(page);

    await page.getByLabel("Your name").fill("Noor");
    await page.getByLabel("Business name").fill(`Night Owl ${Date.now().toString(36)}`);
    await expect(page.getByText("Available")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/onboarding\/brand$/, { timeout: 15_000 });
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/onboarding\/service$/, { timeout: 15_000 });
    await page.getByLabel("Service name").fill("Night cut");
    await page.getByLabel("Price").fill("35");
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/onboarding\/hours$/, { timeout: 15_000 });
    await expectNoAxeViolations(page);
  });
});

test("the account menu switches between light, dark and system", async ({ page }) => {
  test.setTimeout(120_000);
  await businesses.signInWithBusiness(page, "owner", "theme");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/app");
  expect(await isDark(page)).toBe(false);

  const choose = async (name: "Light" | "Dark" | "System") => {
    await page.getByRole("button", { name: /^Account/ }).click();
    await page.getByRole("menuitemradio", { name }).click();
  };

  await choose("Dark");
  expect(await isDark(page)).toBe(true);
  await page.reload(); // remembered, and applied before the first paint
  expect(await isDark(page)).toBe(true);
  await page.getByRole("button", { name: /^Account/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "Dark" })).toBeChecked();
  await page.keyboard.press("Escape");

  await choose("System");
  expect(await isDark(page)).toBe(false); // the emulated system is light
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => isDark(page)).toBe(true); // follows a system change live

  await choose("Light");
  expect(await isDark(page)).toBe(false);
});

test("cards tell screen readers everything they show", async ({ page }) => {
  test.setTimeout(120_000);
  await businesses.signInWithBusiness(page, "owner", "cards");
  await page.goto("/app/staff");
  const card = page.getByRole("button", { name: "Edit Mia" });
  await expect(card).toHaveAccessibleName("Edit Mia");
  await expect(card).toHaveAccessibleDescription(/Active/);
  await expect(card).toHaveAccessibleDescription(/services?/);
});

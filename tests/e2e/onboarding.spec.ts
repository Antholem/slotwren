import { expect, type Page, test } from "@playwright/test";
import QRCode from "qrcode";

import {
  collectConsoleErrors,
  expectNoAxeViolations,
  signInWithMagicLink,
  uniqueEmail,
} from "../support/e2e";

// Needs the local Supabase stack (Auth, Storage, Mailpit): `pnpm db:start`.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const uniqueName = () => `E2E Studio ${Math.random().toString(36).slice(2, 7)}`;

/** Step 1, waiting for hydration (the Detected badge) and the availability check. */
async function fillBasics(page: Page, name: string) {
  await expect(page).toHaveURL(/\/onboarding\/basics$/);
  // Hydrated once the browser timezone is detected (slow on a cold dev server).
  await expect(page.getByText("Detected")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Business name").fill(name);
  await expect(page.getByText("Available")).toBeVisible({ timeout: 10_000 });
}

/** Submit the step and wait for the next page (actions compile slowly on a cold dev server). */
async function submitTo(page: Page, button: string, next: RegExp) {
  await page.getByRole("button", { name: button }).click();
  await expect(page).toHaveURL(next, { timeout: 15_000 });
}

test("sign up, finish the wizard and see the booking link", async ({ page }) => {
  // Six pages, each with an axe scan, plus a real email round trip.
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  const name = uniqueName();

  await signInWithMagicLink(page, uniqueEmail("wizard"));

  // 1 · Business basics
  await fillBasics(page, name);
  const slug = await page.getByLabel("Booking link").inputValue();
  expect(slug).toMatch(/^e2e-studio-[a-z0-9]+$/);
  await expectNoAxeViolations(page);
  await submitTo(page, "Continue", /\/onboarding\/brand$/);

  // 2 · Brand: a too-small logo is explained, a good one uploads to Storage
  await expect(page.getByRole("heading", { name: "Make it look like yours" })).toBeVisible();
  const logo = page.locator('input[type="file"]');
  await logo.setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: await QRCode.toBuffer("tiny", { width: 64 }),
  });
  await expect(page.getByText(/Use at least 256×256/)).toBeVisible();
  await logo.setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: await QRCode.toBuffer("logo", { width: 512 }),
  });
  await expect(page.getByText("Logo uploaded")).toBeVisible({ timeout: 15_000 });
  await page
    .locator("label")
    .filter({ has: page.getByRole("radio", { name: /Indigo/ }) })
    .click();
  await expect(page.getByLabel("Hex")).toHaveValue("#4338CA");
  await expect(page.getByText("passes AA")).toBeVisible();
  await expectNoAxeViolations(page);
  await submitTo(page, "Continue", /\/onboarding\/service$/);

  // 3 · First service
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Name the service")).toBeVisible(); // validated before saving
  await page.getByLabel("Service name").fill("Haircut & Style");
  await page.getByLabel("Duration").selectOption("45");
  await page.getByLabel("Price").fill("35");
  await expectNoAxeViolations(page);
  await submitTo(page, "Continue", /\/onboarding\/hours$/);

  // 4 · Working hours: split Monday, copy it, open Saturday
  await page.getByRole("button", { name: "Add more hours on Monday" }).click();
  await page.getByLabel("Monday closes (range 1)").selectOption("12:00");
  await page.getByLabel("Monday opens (range 2)").selectOption("13:00");
  await page.getByLabel("Monday closes (range 2)").selectOption("18:00");
  await page.getByRole("button", { name: "Copy to all days" }).first().click();
  await expect(page.getByLabel("Friday opens (range 2)")).toHaveValue("13:00");
  await page.getByRole("switch", { name: "Open on Saturday" }).click();
  await expect(page.getByText("6 days open. Sundays closed.")).toBeVisible();
  await expectNoAxeViolations(page);
  await submitTo(page, "Finish and go live", /\/app\/live$/);

  // You're live, inside the dashboard shell
  await expect(
    page.getByRole("heading", { level: 1, name: "You’re live. Customers can book now." }),
  ).toBeVisible();
  await expect(page.getByText(`${name} takes bookings Mon – Sat`)).toBeVisible();
  const link = page.getByLabel("Booking link", { exact: true });
  await expect(link).toHaveValue(new RegExp(`/b/${slug}$`));
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    new RegExp(`^https?://[^/]+/b/${slug}$`),
  );
  await expect(page.getByRole("img", { name: /QR code that opens/ })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  expect((await download).suggestedFilename()).toBe(`${slug}-booking-qr.png`);
  await expect(page.getByRole("link", { name: /Add to your website/ })).toHaveAttribute(
    "href",
    "/app/settings/embed",
  );
  await expectNoAxeViolations(page);

  // Live owners use the dashboard; the wizard sends them there.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 });

  expect(errors).toEqual([]);
});

test("leaving halfway resumes at the same step", async ({ page }) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("resume");
  const name = uniqueName();

  await signInWithMagicLink(page, email);
  await fillBasics(page, name);
  await submitTo(page, "Continue", /\/onboarding\/brand$/);

  await page.getByLabel("Hex").fill("#BE123C");
  await submitTo(page, "Save and finish later", /\/onboarding\/saved$/);

  // Saved, still signed in, and told where setup continues.
  await expect(page.getByRole("heading", { level: 1, name: "Setup saved" })).toBeVisible();
  await expect(page.getByText(/straight back to first service/)).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("link", { name: "Continue setup" }).click();
  await expect(page).toHaveURL(/\/onboarding\/service$/);

  // Earlier answers were kept, and later steps can't be skipped to.
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/onboarding\/brand$/);
  await expect(page.getByLabel("Hex")).toHaveValue("#BE123C");
  await page.goto("/onboarding/hours");
  await expect(page).toHaveURL(/\/onboarding\/service$/);
  await page.goto("/onboarding/basics");
  await expect(page.getByLabel("Business name")).toHaveValue(name);

  // Signing out and back in also picks up at the first unfinished step.
  await page.goto("/onboarding/saved");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in\?signed_out=1$/);
  await signInWithMagicLink(page, email);
  await expect(page).toHaveURL(/\/onboarding\/service$/);
});

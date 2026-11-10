import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "@/server/db/schema";

import { collectConsoleErrors, expectNoAxeViolations } from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

// Needs the local Supabase stack (Auth, Mailpit) and DATABASE_URL (.env.local).

const businesses = liveBusinesses();
const { db } = businesses;
test.afterAll(() => businesses.cleanup());

const businessRow = async (id: string) =>
  (await db.select().from(schema.businesses).where(eq(schema.businesses.id, id)))[0]!;

/** Radios are visually replaced by their labels: choose with the keyboard. */
async function choose(page: Page, name: string) {
  await page.getByRole("radio", { name }).focus();
  await page.keyboard.press("Space");
}

test("an owner changes the booking rules and the booking link", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "settings");
  const oldSlug = fixture.business.slug;
  const newSlug = `moved-${oldSlug}`;

  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Settings sections" });
  await expect(tabs.getByRole("link", { name: "Business" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByLabel("Business name")).toHaveValue(fixture.business.name);
  await expectNoAxeViolations(page);

  // New link: checked live, with a warning that the old one stops working.
  const link = page.getByLabel("Booking link");
  await link.fill(newSlug);
  await expect(page.getByText("Available")).toBeVisible();
  await expect(page.getByText("Old links will stop working")).toBeVisible();
  await expect(page.getByText(`/b/${oldSlug}`, { exact: false }).first()).toBeVisible();

  await page.getByLabel("Minimum notice").selectOption({ label: "1 day" });
  await page.getByLabel("Book up to").fill("30");
  await choose(page, "Every 15 minutes");
  await page.getByLabel("Free cancellation").selectOption({ label: "48 hours before" });
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();
  await expect(page.getByText(`/b/${newSlug}.`, { exact: false })).toBeVisible();

  // The toast doesn't cover the sticky Save bar.
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Settings saved" });
  const bar = page.getByRole("button", { name: "Save changes" }).locator("xpath=..");
  await expect(async () => {
    const [t, b] = [await toast.boundingBox(), await bar.boundingBox()];
    expect(t!.y + t!.height).toBeLessThanOrEqual(b!.y);
  }).toPass();

  expect(await businessRow(fixture.business.id)).toMatchObject({
    slug: newSlug,
    minNoticeMin: 1440,
    maxDaysAhead: 30,
    slotIntervalMin: 15,
    cancellationWindowHours: 48,
  });

  // Saved, so nothing to warn about; and still there after a reload.
  await expect(page.getByText("Old links will stop working")).toBeHidden();
  await page.reload();
  await expect(page.getByLabel("Booking link")).toHaveValue(newSlug);
  await expect(page.getByLabel("Minimum notice")).toHaveValue("1440");
  await expect(page.getByLabel("Book up to")).toHaveValue("30");
  await expect(page.getByRole("radio", { name: "Every 15 minutes" })).toBeChecked();
  await expect(page.getByLabel("Free cancellation")).toHaveValue("48");
  expect(errors).toEqual([]);
});

test("a 30-minute grid rounds staff hours only when the owner asks", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "grid");
  await db
    .update(schema.businesses)
    .set({ slotIntervalMin: 15 })
    .where(eq(schema.businesses.id, fixture.business.id));
  await db.insert(schema.availabilityRules).values({
    businessId: fixture.business.id,
    staffId: fixture.staff.id,
    weekday: 2,
    startTime: "09:15",
    endTime: "17:45",
  });

  await page.goto("/app/settings");
  await choose(page, "Every 30 minutes");
  await expect(page.getByText("Some hours aren't on the 30-minute grid")).toBeVisible();
  const offGrid = page.getByRole("list", { name: "Staff hours off the grid" });
  await expect(offGrid).toContainText("Mia · Tuesday 09:15 – 17:45");

  // Refused until the hours are rounded or fixed.
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "aren't on the 30-minute grid",
  );
  expect((await businessRow(fixture.business.id)).slotIntervalMin).toBe(15);

  await page.getByRole("button", { name: "Round to the 30-minute grid" }).click();
  await expect(offGrid).toContainText("09:15 – 17:45 → 09:30 – 17:30");
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();
  await expect(page.getByText("Rounded 1 staff range to the grid.")).toBeVisible();

  expect((await businessRow(fixture.business.id)).slotIntervalMin).toBe(30);
  const rules = await db
    .select({ start: schema.availabilityRules.startTime, end: schema.availabilityRules.endTime })
    .from(schema.availabilityRules)
    .where(eq(schema.availabilityRules.staffId, fixture.staff.id));
  expect(rules).toEqual([{ start: "09:30:00", end: "17:30:00" }]);
  expect(errors).toEqual([]);
});

test("staff see the business settings read-only", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "staff", "settings");

  await page.goto("/app/settings");
  await expect(page.getByText("Only owners can change these settings.")).toBeVisible();
  await expect(
    page.getByRole("main").getByText(fixture.business.name, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Every 30 minutes")).toBeVisible();
  await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await expectNoAxeViolations(page);

  // The other tabs are there too.
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Notifications" })
    .click();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByText("Coming soon")).toBeVisible();
  await expectNoAxeViolations(page);
  expect(errors).toEqual([]);
});

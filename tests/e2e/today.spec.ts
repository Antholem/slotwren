import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { zoneClock } from "@/lib/zone-clock";
import * as schema from "@/server/db/schema";

import { bookingValues } from "../support/db";
import { collectConsoleErrors, expectNoAxeViolations } from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

// Needs the local Supabase stack (Auth, Mailpit) and DATABASE_URL (.env.local).

const businesses = liveBusinesses();
test.afterAll(() => businesses.cleanup());

const MIN = 60_000;

/**
 * A timezone where it's around midday right now, so "an hour ago" and "in
 * two hours" are both still today, whenever the suite runs.
 */
function middayZone(now = Date.now()) {
  const zones = [
    "Pacific/Honolulu",
    "America/Los_Angeles",
    "America/New_York",
    "America/Sao_Paulo",
    "Europe/London",
    "Asia/Dubai",
    "Asia/Manila",
    "Pacific/Auckland",
  ];
  const distance = (zone: string) => Math.abs(zoneClock(zone).parts(now).minutes - 12 * 60);
  return zones.reduce((best, zone) => (distance(zone) < distance(best) ? zone : best));
}

/** Owner with Mia's day: one ended unmarked, one in progress, one later. */
async function ownerWithADay(page: Page) {
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "today");
  const { db } = businesses;
  await db
    .update(schema.businesses)
    .set({ timezone: middayZone() })
    .where(eq(schema.businesses.id, fixture.business.id));
  const now = Date.now();
  const booking = (startsInMin: number, customerName: string) =>
    bookingValues(fixture, new Date(Math.floor((now + startsInMin * MIN) / MIN) * MIN), {
      customerName,
      status: "confirmed",
    });
  await db
    .insert(schema.bookings)
    .values([booking(-120, "Tom Okafor"), booking(-20, "Grace Lim"), booking(120, "Daniel Cho")]);
  return fixture;
}

const statusOf = async (businessId: string, customerName: string) => {
  const rows = await businesses.db
    .select({ status: schema.bookings.status, name: schema.bookings.customerName })
    .from(schema.bookings)
    .where(eq(schema.bookings.businessId, businessId));
  return rows.find((r) => r.name === customerName)?.status;
};

test("complete and no-show from Now and next", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const fixture = await ownerWithADay(page);

  await page.goto("/app");
  await expect(
    page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)$/ }),
  ).toBeVisible();
  const stats = page.getByRole("region", { name: "Numbers" });
  await expect(stats.getByText("Bookings today")).toBeVisible();
  await expect(stats.getByText(/1 in progress · 1 to go/)).toBeVisible();

  const nowNext = page.getByRole("region", { name: "Now and next" });
  const item = (name: string) => nowNext.getByRole("listitem").filter({ hasText: name });
  await expect(item("Tom Okafor")).toContainText("Not marked yet");
  await expect(item("Grace Lim")).toContainText("In progress");
  await expect(item("Daniel Cho")).toContainText("Confirmed");
  // Later appointments can only be cancelled until they start.
  await expect(item("Daniel Cho").getByRole("button", { name: "Complete" })).toBeDisabled();
  await expect(item("Daniel Cho")).toContainText(/Complete and No-show unlock at \d{2}:\d{2}/);
  if (testInfo.project.name === "desktop") {
    await expect(page.getByRole("region", { name: "Today’s appointments" })).toBeVisible();
  }
  await expectNoAxeViolations(page);

  // Complete: the row leaves the list at once, and the booking is saved as completed.
  await item("Grace Lim").getByRole("button", { name: "Complete" }).click();
  await expect(item("Grace Lim")).toHaveCount(0);
  await expect(page.getByText("Grace Lim: marked complete")).toBeVisible();
  await expect.poll(() => statusOf(fixture.business.id, "Grace Lim")).toBe("completed");

  // No-show on the one that ended unmarked.
  await item("Tom Okafor").getByRole("button", { name: "No-show" }).click();
  await expect(item("Tom Okafor")).toHaveCount(0);
  await expect(page.getByText("Tom Okafor: marked no-show")).toBeVisible();
  await expect.poll(() => statusOf(fixture.business.id, "Tom Okafor")).toBe("no_show");

  // After the refresh: the numbers follow, and the timeline / Earlier today show them.
  await page.reload();
  await expect(stats.getByText(/1 done · 1 to go · 1 no-show/)).toBeVisible();
  if (testInfo.project.name === "desktop") {
    const timeline = page.getByRole("region", { name: "Today’s appointments" });
    await expect(timeline.getByText(/Grace Lim, Haircut, .*, Done/)).toBeAttached();
    await expect(timeline.getByText(/Tom Okafor, Haircut, .*, No-show/)).toBeAttached();
  } else {
    await nowNext.getByRole("button", { name: /Earlier today · 1 done · 1 no-show/ }).click();
    await expect(nowNext.getByText("Grace Lim")).toBeVisible();
  }
  await expect(item("Daniel Cho")).toBeVisible();
  expect(errors).toEqual([]);
});

test("cancel from Now and next asks first", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const fixture = await ownerWithADay(page);
  await page.goto("/app");
  const nowNext = page.getByRole("region", { name: "Now and next" });
  const daniel = nowNext.getByRole("listitem").filter({ hasText: "Daniel Cho" });

  await daniel.getByRole("button", { name: "Cancel" }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel this appointment?" });
  await expect(dialog.getByRole("checkbox", { name: /Email Daniel Cho/ })).toBeChecked();
  await expectNoAxeViolations(page);
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(daniel).toBeVisible();
  await expect.poll(() => statusOf(fixture.business.id, "Daniel Cho")).toBe("confirmed");

  await daniel.getByRole("button", { name: "Cancel" }).click();
  await dialog.getByRole("checkbox", { name: /Email Daniel Cho/ }).click();
  await dialog.getByRole("button", { name: "Cancel appointment" }).click();
  await expect(daniel).toHaveCount(0);
  await expect(page.getByText("Daniel Cho's appointment is cancelled")).toBeVisible();
  await expect.poll(() => statusOf(fixture.business.id, "Daniel Cho")).toBe("cancelled");
  expect(errors).toEqual([]);
});

test("a brand-new business gets the welcome and checklist; the profile name shows in the menu", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "welcome");
  await businesses.db
    .delete(schema.bookings)
    .where(eq(schema.bookings.businessId, fixture.business.id));

  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to Slotwren" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No appointments today" })).toBeVisible();
  const checklist = page.getByRole("region", { name: "Get ready for your first booking" });
  // Business created, and the fixture already has a service.
  await expect(checklist.getByText("2 of 6")).toBeVisible();
  await expect(checklist.getByRole("link", { name: "Invite staff" })).toBeVisible();
  await expectNoAxeViolations(page);

  // Account menu: no name yet, so it offers to add one.
  await page.getByRole("button", { name: "Account (Owner)" }).click();
  await page.getByRole("menuitem", { name: "Add your name" }).click();
  const dialog = page.getByRole("dialog", { name: "Your profile" });
  await dialog.getByLabel("Name").fill(" ");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Enter your name.")).toBeVisible();
  await expectNoAxeViolations(page);
  await dialog.getByLabel("Name").fill("Sam Rivera");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Account: Sam Rivera (Owner)" })).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe("dark", () => {
  test.use({ colorScheme: "dark" });

  test("Today with appointments stays readable (axe)", async ({ page }) => {
    test.setTimeout(120_000);
    await ownerWithADay(page);
    await page.goto("/app");
    await expect(page.getByRole("region", { name: "Now and next" })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

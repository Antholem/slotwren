import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { nextDate, todayIn } from "@/lib/time-off";
import * as schema from "@/server/db/schema";

import { choose } from "../support/booking-flow";
import { collectConsoleErrors, expectNoAxeViolations } from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

// Needs the local Supabase stack (Auth, Mailpit) and DATABASE_URL (.env.local).

const businesses = liveBusinesses();
test.afterAll(() => businesses.cleanup());

/** Owner whose Mia works 09:00–17:00 every day (the fixture business is in Manila). */
async function ownerWithHours(page: Parameters<typeof businesses.signInWithBusiness>[0]) {
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "calendar");
  await businesses.db.insert(schema.availabilityRules).values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      businessId: fixture.business.id,
      staffId: fixture.staff.id,
      weekday,
      startTime: "09:00",
      endTime: "17:00",
    })),
  );
  return fixture;
}

const bookingsOf = async (businessId: string, customerName: string) =>
  (
    await businesses.db
      .select({
        name: schema.bookings.customerName,
        status: schema.bookings.status,
        startsAt: schema.bookings.startsAt,
      })
      .from(schema.bookings)
      .where(eq(schema.bookings.businessId, businessId))
  ).filter((row) => row.name === customerName);

test("create from an empty slot → open the drawer → reschedule → cancel", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const errors = collectConsoleErrors(page);
  const fixture = await ownerWithHours(page);
  const day = nextDate(todayIn("Asia/Manila", new Date()), 1);

  await page.goto(`/app/calendar?view=day&date=${day}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (testInfo.project.name === "desktop") {
    // The sidebar (a menu sheet on phones) marks Calendar as the current page.
    await expect(page.getByRole("link", { name: "Calendar" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  await expectNoAxeViolations(page);

  // Keyboard: arrows move between cells, Enter books the free one.
  const nine = page.getByRole("button", { name: /, 09:00, Mia: free\. New booking$/ });
  await nine.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: /, 09:30, Mia: free\. New booking$/ }),
  ).toBeFocused();
  await page.keyboard.press("Escape");

  // Click the empty 10:00 slot: the sheet opens with the time picked.
  await page.getByRole("button", { name: /, 10:00, Mia: free\. New booking$/ }).click();
  const sheet = page.getByRole("dialog", { name: "New booking" });
  await expect(sheet.getByRole("radio", { name: "10:00" })).toBeChecked();
  await expect(sheet.getByLabel("With")).toHaveValue(fixture.staff.id);
  await sheet.getByRole("button", { name: "Book appointment" }).click();
  await expect(sheet.getByText("Find a customer, or add a new one.")).toBeVisible();
  await sheet.getByRole("button", { name: "New customer" }).click();
  await sheet.getByLabel("Name").fill("Rosa Cruz");
  await sheet.getByLabel("Email").fill(`rosa-${Date.now()}@example.com`);
  await expectNoAxeViolations(page);
  await sheet.getByRole("button", { name: "Book appointment" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Booked Rosa Cruz at 10:00")).toBeVisible();
  await expect
    .poll(async () => (await bookingsOf(fixture.business.id, "Rosa Cruz"))[0]?.status)
    .toBe("confirmed");

  // The slot now opens the booking.
  await page
    .getByRole("button", { name: /, 10:00, Mia: Rosa Cruz, Haircut, Confirmed\. Open booking$/ })
    .click();
  const drawer = page.getByRole("dialog", { name: "Booking details" });
  await expect(drawer.getByText("10:00 – 10:45")).toBeVisible();
  await expect(drawer.getByText("Booked through: Manual")).toBeVisible(); // source badge
  await expect(drawer.getByText(/^Booked by /)).toBeVisible();
  await expectNoAxeViolations(page);

  // Reschedule to 13:00.
  await drawer.getByRole("button", { name: "Reschedule" }).click();
  await choose(drawer.getByRole("radio", { name: "13:00" }));
  await drawer.getByRole("button", { name: "Move booking" }).click();
  await expect(page.getByText("Moved to 13:00")).toBeVisible();
  await expect(drawer.getByText("13:00 – 13:45")).toBeVisible();
  await expect(drawer.getByText(/^Moved to .*13:00/)).toBeVisible();
  await expectNoAxeViolations(page);

  // Cancel it.
  await drawer.getByRole("button", { name: "Cancel booking" }).click();
  await expect(drawer.getByRole("heading", { name: "Cancel this booking?" })).toBeVisible();
  await drawer.getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByText("Booking cancelled")).toBeVisible();
  await expect(drawer.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await bookingsOf(fixture.business.id, "Rosa Cruz"))[0]?.status)
    .toBe("cancelled");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  expect(errors).toEqual([]);
});

test("week view, and Today's New booking opens the same sheet", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  await ownerWithHours(page);

  await page.goto("/app/calendar");
  await expect(page.getByRole("link", { name: "Week", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: /, today: open day view$/ })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("link", { name: "Next week" }).click();
  await expect(page).toHaveURL(/view=week&date=\d{4}-\d{2}-\d{2}/);

  await page.goto("/app");
  await page.getByRole("button", { name: "New booking" }).click();
  const sheet = page.getByRole("dialog", { name: "New booking" });
  await expect(sheet.getByLabel("Service")).toBeVisible();
  await expectNoAxeViolations(page);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  expect(errors).toEqual([]);
});

test.describe("dark", () => {
  test.use({ colorScheme: "dark" });

  test("the calendar stays readable (axe)", async ({ page }) => {
    test.setTimeout(120_000);
    await ownerWithHours(page);
    await page.goto("/app/calendar");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

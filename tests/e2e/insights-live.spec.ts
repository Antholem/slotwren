import { expect, type Locator, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { zoneClock } from "@/lib/zone-clock";
import * as schema from "@/server/db/schema";

import { asNewVisitor, bookThroughPage } from "../support/booking-flow";
import { bookingValues } from "../support/db";
import { collectConsoleErrors, expectNoAxeViolations } from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

// Needs the local Supabase stack (Auth, Mailpit, Realtime) and DATABASE_URL (.env.local).

const businesses = liveBusinesses();
test.afterAll(() => businesses.cleanup());

/** A timezone where it's morning now, so today still has times to book, whenever this runs. */
function morningZone(now = Date.now()) {
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
  const distance = (zone: string) => Math.abs(zoneClock(zone).parts(now).minutes - 9 * 60);
  return zones.reduce((best, zone) => (distance(zone) < distance(best) ? zone : best));
}

/** Owner of a business the public can book today: Mia works 00:00–23:45 every day. */
async function ownerOfBookableBusiness(page: Page) {
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "live");
  const { db } = businesses;
  await db
    .update(schema.businesses)
    .set({
      timezone: morningZone(),
      minNoticeMin: 0,
      settings: {
        openingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          start: "00:00",
          end: "23:45",
        })),
      },
    })
    .where(eq(schema.businesses.id, fixture.business.id));
  await db.insert(schema.availabilityRules).values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      businessId: fixture.business.id,
      staffId: fixture.staff.id,
      weekday,
      startTime: "00:00",
      endTime: "23:45",
    })),
  );
  return fixture;
}

/** The name as shown (Now and next also has a screen-reader summary, and phone and desktop copies). */
const shown = (region: Locator, name: string) =>
  region.getByText(name, { exact: true }).filter({ visible: true });

const live = (page: Page) =>
  expect(page.locator("html")).toHaveAttribute("data-live", "subscribed");

test("a booking made on the public page appears on Today within seconds, and leaves when cancelled", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const errors = collectConsoleErrors(page);
  const fixture = await ownerOfBookableBusiness(page);
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await live(page);
  const nowNext = page.getByRole("region", { name: "Now and next" });

  // A customer books in another browser.
  const visitor = await browser.newContext();
  const customer = await visitor.newPage();
  await asNewVisitor(customer);
  await bookThroughPage(customer, fixture, 0);
  await visitor.close();

  // No reload: the toast and the appointment arrive by Realtime.
  await expect(page.getByText("New booking from booking page")).toBeVisible({ timeout: 8_000 });
  await expect(shown(nowNext, "Rosa Cruz")).toBeVisible({ timeout: 8_000 });

  // Cancelled elsewhere (here: straight in the database): it leaves Today live too.
  await businesses.db
    .update(schema.bookings)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: "customer" })
    .where(eq(schema.bookings.businessId, fixture.business.id));
  await expect(shown(nowNext, "Rosa Cruz")).toHaveCount(0, { timeout: 8_000 });
  expect(errors).toEqual([]);
});

test("after being offline, the dashboard catches up on what it missed", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const fixture = await ownerOfBookableBusiness(page);
  await page.goto("/app");
  await live(page);

  await context.setOffline(true);
  const zone = morningZone();
  const clock = zoneClock(zone);
  const later = Math.ceil((Date.now() + 2 * 3_600_000) / 900_000) * 900_000;
  await businesses.db.insert(schema.bookings).values(
    bookingValues(fixture, new Date(later), {
      customerName: "Missed Meanwhile",
      status: "confirmed",
    }),
  );
  // Only if it's still today there: otherwise Today wouldn't list it anyway.
  test.skip(
    clock.parts(later).date !== clock.parts(Date.now()).date,
    "late in the day in this zone",
  );
  await context.setOffline(false);

  await expect(
    shown(page.getByRole("region", { name: "Now and next" }), "Missed Meanwhile"),
  ).toBeVisible({ timeout: 15_000 });
  await live(page);
});

test("insights: charts with table views, readable in light and dark", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "insights");
  const now = Date.now();
  await businesses.db.insert(schema.bookings).values(
    Array.from({ length: 10 }, (_, i) =>
      bookingValues(fixture, new Date(now - (i * 3 + 1) * 86_400_000), {
        status: i === 3 ? "no_show" : "completed",
        source: (["page", "widget", "ai", "manual"] as const)[i % 4],
      }),
    ),
  );

  await page.goto("/app/insights");
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
  await expect(page.getByRole("link", { name: "12 weeks" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const totals = page.getByRole("list", { name: "Totals" });
  await expect(totals.getByText("Bookings, 12 weeks")).toBeVisible();
  await expect(totals.getByText("10", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Bookings per week/ })).toBeVisible();
  await expectNoAxeViolations(page);

  // Every chart has a table for screen readers (and anyone who prefers one).
  const weekly = page.getByRole("region", { name: "Bookings per week" });
  await weekly.getByRole("button", { name: "View as table" }).click();
  await expect(weekly.getByRole("table")).toBeVisible();
  const heat = page.getByRole("region", { name: "Busiest hours" });
  await heat.getByRole("button", { name: "View as table" }).click();
  await expect(heat.getByRole("rowheader", { name: "Monday" })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("link", { name: "4 weeks" }).click();
  await expect(page).toHaveURL(/range=4w/);
  await expect(totals.getByText("Bookings, 4 weeks")).toBeVisible();

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/app/insights");
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
  await expectNoAxeViolations(page);
  expect(errors).toEqual([]);
});

test("insights for a business with no bookings yet shows the empty state", async ({ page }) => {
  test.setTimeout(90_000);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "insights-empty");
  await businesses.db
    .delete(schema.bookings)
    .where(eq(schema.bookings.businessId, fixture.business.id));
  await page.goto("/app/insights");
  await expect(page.getByRole("heading", { name: "No insights yet" })).toBeVisible();
  await expectNoAxeViolations(page);
});

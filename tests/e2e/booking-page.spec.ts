import { expect, type Locator, type Page, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import * as schema from "@/server/db/schema";

import { bookingValues, connectTestDb, createFixtureBusiness } from "../support/db";
import { collectConsoleErrors, expectNoAxeViolations } from "../support/e2e";

/*
 * The public booking page as a customer (no session), on desktop and on a
 * phone (both Playwright projects). Needs DATABASE_URL (.env.local).
 */

const { db, close } = connectTestDb();
type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;
const fixtures: Fixture[] = [];
test.afterAll(async () => {
  for (const fixture of fixtures) await fixture.cleanup();
  await close();
});

// The customer is in the business's timezone unless a test says otherwise.
test.use({ timezoneId: "Asia/Manila" });

const CRIMSON = "#BE123C";

/** A live business: Mia does the haircut (45 min + 15 min clean-up), 08:00–20:00 daily. */
async function bookableBusiness() {
  const fixture = await createFixtureBusiness(db);
  fixtures.push(fixture);
  const businessId = fixture.business.id;
  await db
    .update(schema.businesses)
    .set({
      onboardedAt: new Date(),
      setupStep: 4,
      brandColor: CRIMSON,
      address: "12 Lumen Lane, Makati",
      minNoticeMin: 0,
      settings: {
        openingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          start: "08:00",
          end: "20:00",
        })),
      },
    })
    .where(eq(schema.businesses.id, businessId));
  await db
    .insert(schema.staffServices)
    .values({ businessId, staffId: fixture.staff.id, serviceId: fixture.service.id });
  await db.insert(schema.availabilityRules).values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      businessId,
      staffId: fixture.staff.id,
      weekday,
      startTime: "08:00",
      endTime: "20:00",
    })),
  );
  return fixture;
}

/** The visible one of a button that appears in both the phone bar and the desktop card. */
const visibleButton = (page: Page, name: string) =>
  page.locator("button:visible", { hasText: name }).first();
const timeChips = (page: Page) => page.getByRole("radio", { name: /^\d{2}:\d{2}$/ });

/** Pick a card or chip the way a customer does: tap its label (the radio is visually hidden). */
async function choose(radio: Locator) {
  await radio.locator("xpath=ancestor::label[1]").click();
  await expect(radio).toBeChecked();
}

async function pressContinue(page: Page) {
  const button = visibleButton(page, "Continue");
  await expect(button).toBeEnabled();
  await button.focus();
  await page.keyboard.press("Enter");
}

/** Service and staff steps, landing on the times. */
async function toTimes(page: Page, fixture: Fixture) {
  await page.goto(`/b/${fixture.business.slug}`);
  await choose(page.getByRole("radio", { name: /Haircut/ }));
  await pressContinue(page);
  await expect(page).toHaveURL(/step=staff/);
  await pressContinue(page);
  await expect(page).toHaveURL(/step=time/);
  await expect(timeChips(page).first()).toBeAttached();
}

test("a customer books with the keyboard and sees the confirmation", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const fixture = await bookableBusiness();
  const { slug, name } = fixture.business;

  // Step 1: service
  await page.goto(`/b/${slug}`);
  await expect(page).toHaveTitle(`${name} · Book online`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Book with ${name}`);
  await expectNoAxeViolations(page);
  const haircut = page.getByRole("radio", { name: /Haircut/ });
  await haircut.focus();
  await page.keyboard.press("Space");
  await expect(haircut).toBeChecked();
  // The brand colour is the button colour.
  await expect(visibleButton(page, "Continue")).toHaveCSS("background-color", "rgb(190, 18, 60)");
  await pressContinue(page);

  // Step 2: Anyone available is the default
  await expect(page).toHaveURL(/step=staff/);
  await expect(page.getByRole("radio", { name: /Anyone available/ })).toBeChecked();
  await expect(page.locator("label").filter({ hasText: "Mia" })).toContainText(/Next free/);
  await expectNoAxeViolations(page);
  await pressContinue(page);

  // Step 3: arrow keys move through the times
  await expect(page).toHaveURL(/step=time/);
  await expect(page.getByText("Times shown in your timezone (GMT+8)")).toBeVisible();
  const chips = timeChips(page);
  await expect(chips.first()).toBeAttached();
  await expectNoAxeViolations(page);
  await chips.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(chips.nth(1)).toBeChecked();
  const start = await chips.nth(1).getAttribute("value");
  await pressContinue(page);

  // Back and Forward walk the steps.
  await expect(page).toHaveURL(/step=details/);
  await page.goBack();
  await expect(page).toHaveURL(/step=time/);
  await page.goForward();
  await expect(page).toHaveURL(/step=details/);

  // Step 4: details
  const email = `rosa-${Date.now()}@example.com`;
  await page.getByLabel("Full name").fill("Rosa Cruz");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Phone").fill("+63 917 555 0100");
  await page.getByLabel("Notes").fill("First visit");
  await expect(
    page.locator("p:visible", { hasText: "Free cancellation up to 24 h before" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  const confirm = visibleButton(page, "Confirm booking");
  await confirm.focus();
  await page.keyboard.press("Enter");

  // Confirmed
  await expect(page).toHaveURL(new RegExp(`/b/${slug}/booked/`));
  await expect(page.getByRole("heading", { level: 1, name: "You’re booked" })).toBeVisible();
  const [booking] = await db
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.businessId, fixture.business.id),
        eq(schema.bookings.startsAt, new Date(start!)),
      ),
    );
  expect(booking).toMatchObject({ status: "confirmed", source: "page", priceCents: 3500 });
  const details = page.getByRole("region", { name: "Booking details" });
  await expect(details).toContainText(booking!.code);
  await expect(details).toContainText("Haircut");
  await expect(details).toContainText("12 Lumen Lane, Makati");
  await expect(page).toHaveTitle(`Booked · ${name}`);
  await expectNoAxeViolations(page);

  const [customer] = await db
    .select({ email: schema.customers.email, phone: schema.customers.phone })
    .from(schema.customers)
    .where(eq(schema.customers.id, booking!.customerId));
  expect(customer).toEqual({ email, phone: "+63 917 555 0100" });

  // Add to calendar
  await expect(page.getByRole("link", { name: /Google/ })).toHaveAttribute(
    "href",
    /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/,
  );
  const ics = await page.request.get(
    (await page.getByRole("link", { name: /\.ics/ }).getAttribute("href"))!,
  );
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  expect(await ics.text()).toContain(`Booking code ${booking!.code}`);
  expect(errors).toEqual([]);
});

test("a time taken while the customer types sends them back with the nearest openings", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const fixture = await bookableBusiness();
  await toTimes(page, fixture);
  await choose(timeChips(page).nth(1));
  await pressContinue(page);
  await expect(page).toHaveURL(/step=details/);
  const start = new URL(page.url()).searchParams.get("start")!;

  // Someone else books it first.
  await db.insert(schema.bookings).values(bookingValues(fixture, new Date(start)));
  await page.getByLabel("Full name").fill("Rosa Cruz");
  await page.getByLabel("Email").fill(`late-${Date.now()}@example.com`);
  await visibleButton(page, "Confirm booking").click();

  await expect(page).toHaveURL(/step=time/);
  await expect(page).toHaveURL(new RegExp(`taken=${encodeURIComponent(start)}`));
  const alert = page.getByRole("alert").filter({ hasText: "That time was just taken" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("These are the nearest openings:");
  await expect(visibleButton(page, "Continue")).toBeDisabled();
  await expectNoAxeViolations(page);

  // One tap on an alternative, then on to the details again.
  const alternative = alert.getByRole("button").first();
  const label = (await alternative.textContent())!.trim();
  await alternative.click();
  await expect(page.getByRole("radio", { name: label, exact: true })).toBeChecked();
  await pressContinue(page);
  await expect(page).toHaveURL(/step=details/);
  expect(new URL(page.url()).searchParams.get("start")).not.toBe(start);
  expect(errors).toEqual([]);
});

test("a day without times offers the next opening", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await bookableBusiness();
  // Mia is away for the next four days, Manila time.
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const midnight = new Date(`${today}T00:00:00+08:00`);
  await db.insert(schema.timeOff).values({
    businessId: fixture.business.id,
    staffId: fixture.staff.id,
    startsAt: midnight,
    endsAt: new Date(midnight.getTime() + 4 * 86_400_000),
    allDay: true,
  });
  const tomorrow = new Date(midnight.getTime() + 86_400_000 + 8 * 3_600_000)
    .toISOString()
    .slice(0, 10);

  await toTimes(page, fixture); // lands on the first day with times
  const url = new URL(page.url());
  url.searchParams.set("date", tomorrow);
  await page.goto(url.pathname + url.search);
  await expect(page.getByRole("heading", { name: "No times this day" })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: /^Next available:/ }).click();
  await expect(timeChips(page).first()).toBeChecked();
  await expect(visibleButton(page, "Continue")).toBeEnabled();
});

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("every step and the confirmation stay readable", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectConsoleErrors(page);
    const fixture = await bookableBusiness();
    await page.goto(`/b/${fixture.business.slug}`);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(
      true,
    );
    await expectNoAxeViolations(page);

    await choose(page.getByRole("radio", { name: /Haircut/ }));
    await expectNoAxeViolations(page); // the selected, brand-tinted card
    await pressContinue(page);
    await expectNoAxeViolations(page);
    await pressContinue(page);
    await expect(timeChips(page).first()).toBeAttached();
    await choose(timeChips(page).first());
    await expectNoAxeViolations(page);
    await pressContinue(page);
    await expect(page.getByLabel("Full name")).toBeVisible();
    await expectNoAxeViolations(page);

    const [booking] = await db
      .insert(schema.bookings)
      .values(bookingValues(fixture, new Date(Date.now() + 3 * 86_400_000)))
      .returning({ id: schema.bookings.id });
    await page.goto(`/b/${fixture.business.slug}/booked/${booking!.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "You’re booked" })).toBeVisible();
    await expectNoAxeViolations(page);
    expect(errors).toEqual([]);
  });
});

test("a booking link unfurls with the business's own preview", async ({ page, request }) => {
  const fixture = await bookableBusiness();
  await page.goto(`/b/${fixture.business.slug}`);
  const description = await page.locator('meta[name="description"]').getAttribute("content");
  expect(description).toContain(`Book Haircut with ${fixture.business.name}.`);
  const image = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(image).toContain(`/b/${fixture.business.slug}/opengraph-image`);
  const response = await request.get(new URL(image!).pathname + new URL(image!).search);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
});

test("unknown pages, booking links and bookings get the branded 404", async ({ page }) => {
  const fixture = await bookableBusiness();
  for (const path of [
    "/b/no-such-business-here",
    "/b/NOT_A_SLUG",
    "/nowhere",
    `/b/${fixture.business.slug}/booked/00000000-0000-4000-8000-000000000000`,
    `/b/${fixture.business.slug}/booked/not-an-id`,
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "We can’t find that page" }),
    ).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Go to the home page" })).toHaveAttribute(
    "href",
    "/",
  );
  await expectNoAxeViolations(page);
});

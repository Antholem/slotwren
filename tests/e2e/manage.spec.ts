import { randomBytes } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "@/server/db/schema";

import {
  asNewVisitor,
  bookableBusinesses,
  bookThroughPage,
  choose,
  type Fixture,
  pressContinue,
  timeChips,
} from "../support/booking-flow";
import { bookingValues, issueManageToken } from "../support/db";
import { collectConsoleErrors, expectNoAxeViolations } from "../support/e2e";

/*
 * The manage page as the customer, from the link on the confirmation page:
 * reschedule (the old link stops working), cancel, the closed-window view and
 * wrong links. Desktop and phone. Needs DATABASE_URL (.env.local).
 */

const businesses = bookableBusinesses();
const { db } = businesses;
test.afterAll(() => businesses.cleanup());
test.use({ timezoneId: "Asia/Manila" });
test.beforeEach(({ page }) => asNewVisitor(page));

const bookingRow = async (id: string) =>
  (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0]!;

/** A booking straight in the database with a known manage token. */
async function bookingWithToken(fixture: Fixture, startsAt: Date) {
  const [row] = await db
    .insert(schema.bookings)
    .values(bookingValues(fixture, startsAt))
    .returning();
  const token = await issueManageToken(db, row!);
  return { token, id: row!.id };
}

const manageHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Manage booking" });

test("book, open the manage link, reschedule, then cancel", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectConsoleErrors(page);
  const fixture = await businesses.create();
  // Bookable a day ahead at the earliest, changeable online until an hour before:
  // whatever the time now, the booking is well inside its free-change window.
  await db
    .update(schema.businesses)
    .set({ cancellationWindowHours: 1, minNoticeMin: 24 * 60 })
    .where(eq(schema.businesses.id, fixture.business.id));
  const { start } = await bookThroughPage(page, fixture);
  const bookingId = page.url().split("/booked/")[1]!;

  // Confirmation → Manage booking
  await page.getByRole("link", { name: "Manage booking" }).click();
  await expect(page).toHaveURL(/\/m\/[A-Za-z0-9_-]{43}$/);
  const firstLink = new URL(page.url()).pathname;
  await expect(manageHeading(page)).toBeVisible();
  await expect(page).toHaveTitle(`Manage booking · ${fixture.business.name}`);
  const booking = page.getByRole("region", { name: "Your booking" });
  await expect(booking).toContainText("Haircut with Mia");
  await expect(booking).toContainText("Rosa Cruz");
  await expect(booking).toContainText("Confirmed");
  await expect(page.getByText(/Free cancellation until .*from now/)).toBeVisible();
  await expectNoAxeViolations(page);

  // Reschedule: the booking page's own time picker, same person.
  await page.getByRole("link", { name: "Reschedule" }).click();
  await expect(page).toHaveURL(/step=time/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Reschedule your booking" }),
  ).toBeAttached();
  await expect(timeChips(page).first()).toBeAttached();
  await expectNoAxeViolations(page);
  const values = await timeChips(page).evaluateAll((radios) =>
    radios.map((r) => (r as HTMLInputElement).value),
  );
  // Its own time is free to pick (it isn't shown as taken); pick another one.
  expect(values).toContain(start);
  const target = values.find((value) => value !== start)!;
  await choose(page.locator(`input[name="time"][value="${target}"]`));
  await pressContinue(page);

  await expect(page).toHaveURL(/step=confirm/);
  await expect(page.getByRole("heading", { name: /Move your Haircut with Mia/ })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Confirm new time" }).click();

  await expect(page).toHaveURL(/\/m\/[A-Za-z0-9_-]{43}\?done=moved$/);
  const movedTo = new URL(page.url()).pathname;
  await expect(page.getByRole("status")).toContainText("your booking has moved");
  expect(new URL(page.url()).pathname).not.toBe(firstLink);
  expect((await bookingRow(bookingId)).startsAt).toEqual(new Date(target));

  // The old link is retired.
  const oldPage = await page.context().newPage();
  const old = await oldPage.goto(firstLink);
  expect(old?.status()).toBe(404);
  await oldPage.close();

  // Cancel, with a confirm dialog.
  await page.getByRole("button", { name: "Cancel booking" }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel this booking?" });
  await expect(dialog).toBeVisible();
  await expectNoAxeViolations(page);
  await dialog.getByRole("button", { name: "Cancel booking" }).click();

  // Cancelling revokes every manage link, so the customer lands on the
  // booking's confirmation page, now showing it cancelled.
  await expect(page).toHaveURL(
    new RegExp(`/b/${fixture.business.slug}/booked/${bookingId}\\?cancelled=1$`),
  );
  await expect(page.getByRole("status")).toContainText("You’ve cancelled your booking");
  await expect(page.getByRole("heading", { level: 1, name: "Booking cancelled" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Book another time" })).toBeVisible();
  const movedLink = await page.context().newPage();
  expect((await movedLink.goto(movedTo))?.status()).toBe(404);
  await movedLink.close();
  expect(await bookingRow(bookingId)).toMatchObject({
    status: "cancelled",
    cancelledBy: "customer",
  });
  await expectNoAxeViolations(page);
  expect(errors).toEqual([]);
});

test("after the cancellation window: the policy and how to reach the business", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  const fixture = await businesses.create();
  // Three hours away; free cancellation closes 24 h before.
  const { token } = await bookingWithToken(fixture, new Date(Date.now() + 3 * 3_600_000));

  await page.goto(`/m/${token}`);
  await expect(manageHeading(page)).toBeVisible();
  const contact = page.getByRole("region", {
    name: "Online changes close 24 h before the appointment",
  });
  await expect(contact).toBeVisible();
  await expect(contact.getByRole("link", { name: "+63 2 8000 0000" })).toHaveAttribute(
    "href",
    "tel:+63280000000",
  );
  await expect(contact.getByRole("link", { name: "frontdesk@example.com" })).toHaveAttribute(
    "href",
    "mailto:frontdesk@example.com",
  );
  await expect(page.getByRole("link", { name: "Reschedule" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel booking" })).toHaveCount(0);
  await expectNoAxeViolations(page);

  // Going straight to the time picker shows the same view.
  await page.goto(`/m/${token}?step=time`);
  await expect(manageHeading(page)).toBeVisible();
  await expect(timeChips(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("the manage page and its confirm step stay readable", async ({ page }) => {
    const fixture = await businesses.create();
    const { token } = await bookingWithToken(fixture, new Date(Date.now() + 5 * 86_400_000));
    await page.goto(`/m/${token}`);
    await expect(manageHeading(page)).toBeVisible();
    await expectNoAxeViolations(page);
    const start = new Date(Date.now() + 6 * 86_400_000);
    start.setUTCMinutes(0, 0, 0);
    await page.goto(`/m/${token}?step=confirm&start=${start.toISOString()}`);
    await expect(page.getByRole("button", { name: "Confirm new time" })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test("wrong or malformed manage links get the branded 404", async ({ page }) => {
  for (const path of [
    `/m/${randomBytes(32).toString("base64url")}`,
    "/m/not-a-token",
    "/m/",
    "/m",
    "/b",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "We can’t find that page" }),
    ).toBeVisible();
  }
  await expectNoAxeViolations(page);
});

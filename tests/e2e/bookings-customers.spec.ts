import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { nextDate, todayIn, zonedInstant } from "@/lib/time-off";
import * as schema from "@/server/db/schema";

import { bookingValues } from "../support/db";
import { collectConsoleErrors, expectNoAxeViolations } from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

// Needs the local Supabase stack (Auth, Mailpit) and DATABASE_URL (.env.local).

const businesses = liveBusinesses();
test.afterAll(() => businesses.cleanup());

const MANILA = "Asia/Manila"; // the fixture business's timezone

test("⌘K → open a customer → edit their private notes", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "palette");

  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The top bar streams in after the heading: retry until its shortcut is listening.
  const palette = page.getByRole("dialog", { name: "Search" });
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await palette.getByRole("combobox").fill("Ana San");
  const option = palette.getByRole("option", { name: /Ana Santos/ });
  await expect(option).toBeVisible();
  await expectNoAxeViolations(page);
  await page.keyboard.press("ArrowDown"); // first result is already active; stay keyboard-only
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`/app/customers/${fixture.customer.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Ana Santos" })).toBeVisible();
  await expect(page.getByText("Customer since")).toBeVisible();
  await expectNoAxeViolations(page);

  const notes = page.getByLabel("Private notes about Ana Santos");
  await notes.fill("Sensitive scalp: patch test 48 h before any colour.");
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByText("Notes saved")).toBeVisible();
  await expect(page.getByText(/^Edited by .* · \d{1,2} \w{3}, \d{2}:\d{2}$/)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Private notes about Ana Santos")).toHaveValue(
    "Sensitive scalp: patch test 48 h before any colour.",
  );
  const [row] = await businesses.db
    .select({ notes: schema.customers.notes, by: schema.customers.notesUpdatedBy })
    .from(schema.customers)
    .where(eq(schema.customers.id, fixture.customer.id));
  expect(row!.notes).toBe("Sensitive scalp: patch test 48 h before any colour.");
  expect(row!.by).not.toBeNull();

  // The palette also finds pages; this time open it from the top bar's search button.
  await page.getByRole("button", { name: /^Search/ }).click();
  await palette.getByRole("combobox").fill("calend");
  await palette.getByRole("option", { name: "Calendar" }).click();
  await expect(page).toHaveURL(/\/app\/calendar/);
  expect(errors).toEqual([]);
});

test("filter bookings, cancel one in bulk, and export the filter as CSV", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "bookings");
  const day = nextDate(todayIn(MANILA, new Date()), 2);
  const at = (time: string) => zonedInstant(day, time, MANILA);
  await businesses.db.insert(schema.bookings).values([
    bookingValues(fixture, at("09:00"), { code: "SW-E2E1-01", customerName: "Grace Lim" }),
    bookingValues(fixture, at("11:00"), {
      code: "SW-E2E1-02",
      customerName: "Daniel Cho",
      source: "widget",
    }),
    bookingValues(fixture, at("13:00"), {
      code: "SW-E2E1-03",
      customerName: '=HYPERLINK("http://evil.example","Click me")',
      status: "pending",
    }),
    bookingValues(fixture, at("15:00"), {
      code: "SW-E2E1-04",
      customerName: "Kai Tan",
      status: "cancelled",
    }),
  ]);

  await page.goto("/app/bookings");
  await expect(page.getByRole("heading", { level: 1, name: "Bookings" })).toBeVisible();
  const table = page.getByRole("table");
  // Next 7 days by default: the four above (the fixture's 2030 booking is out of range).
  await expect(table.getByRole("row")).toHaveCount(5);
  // The wide table scrolls inside its card; the page itself never scrolls sideways.
  // (Phones widen the layout viewport to fit, so compare with the device width.)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await expectNoAxeViolations(page);

  // Filter: widget bookings only.
  await page.getByLabel("Source").selectOption("widget");
  await expect(page).toHaveURL(/source=widget/);
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByText("Daniel Cho")).toBeVisible();
  await page.getByLabel("Source").selectOption("");

  // Search by code.
  await page.getByLabel("Search customer, email or code").fill("e2e1-01");
  await expect(page).toHaveURL(/q=e2e1-01/);
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByText("Grace Lim")).toBeVisible();
  await page.getByLabel("Search customer, email or code").fill("");
  await expect(table.getByRole("row")).toHaveCount(5);

  // Bulk cancel, with confirmation.
  await table.getByRole("checkbox", { name: /Select Grace Lim/ }).click();
  const bar = page.getByRole("region", { name: "Selected bookings" });
  await expect(bar.getByText("1 selected")).toBeVisible();
  await bar.getByRole("button", { name: "Cancel bookings" }).click();
  const confirm = page.getByRole("dialog", { name: "Cancel 1 booking?" });
  await expectNoAxeViolations(page);
  await confirm.getByRole("button", { name: "Cancel bookings" }).click();
  await expect(page.getByText("Cancelled 1 booking")).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "Grace Lim" })).toContainText("Cancelled");

  // Only active ones, then export exactly that.
  await page.getByLabel("Status").selectOption("confirmed");
  await expect(page).toHaveURL(/status=confirmed/);
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByRole("cell", { name: "SW-E2E1-02", exact: true })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^test-[0-9a-f]+-bookings-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile((await download.path())!, "utf8");
  const lines = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);
  expect(lines[0]).toContain('"Code","Date","Start"');
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain('"SW-E2E1-02"');
  expect(lines[1]).toContain(`"${day}","11:00"`);

  // The formula-shaped name is exported as text.
  await page.getByLabel("Status").selectOption("pending");
  await expect(page).toHaveURL(/status=pending/);
  await expect(table.getByRole("cell", { name: "SW-E2E1-03", exact: true })).toBeVisible();
  const [pending] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export CSV" }).click(),
  ]);
  const evil = await readFile((await pending.path())!, "utf8");
  expect(evil).toContain(`"'=HYPERLINK(""http://evil.example"",""Click me"")"`);

  // A row opens the booking drawer.
  await table.getByRole("button", { name: /open booking SW-E2E1-03/ }).click();
  await expect(page.getByRole("dialog", { name: "Booking details" })).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe("dark", () => {
  test.use({ colorScheme: "dark" });

  test("bookings, customers and a profile stay readable (axe)", async ({ page }) => {
    test.setTimeout(120_000);
    const { fixture } = await businesses.signInWithBusiness(page, "owner", "dark-lists");
    for (const path of [
      "/app/bookings?range=all",
      "/app/customers",
      `/app/customers/${fixture.customer.id}`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoAxeViolations(page);
    }
  });
});

test("staff get bulk-select checkboxes only on their own bookings", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "staff", "bulk-staff");
  const { db } = businesses;
  // The signed-in staff member is the business's only member.
  const [member] = await db
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(eq(schema.memberships.businessId, fixture.business.id));
  const [me] = await db
    .insert(schema.staff)
    .values({
      businessId: fixture.business.id,
      name: "Jonah",
      color: "violet",
      userId: member!.userId,
    })
    .returning({ id: schema.staff.id });
  await db.insert(schema.bookings).values(
    bookingValues(fixture, new Date("2030-05-02T01:00:00Z"), {
      staffId: me!.id,
      customerName: "Jonah's Client",
    }),
  );

  await page.goto("/app/bookings?range=all");
  const table = page.getByRole("table");
  await expect(table.getByRole("button", { name: /^Jonah's Client/ })).toBeVisible();
  // Mia's booking (from the fixture) has no checkbox; Jonah's own does.
  await expect(table.getByRole("checkbox", { name: /^Select Ana Santos,/ })).toHaveCount(0);
  await table.getByRole("checkbox", { name: /^Select Jonah's Client,/ }).check();
  await table.getByRole("checkbox", { name: "Select all your bookings on this page" }).click();
  await expect(page.getByRole("region", { name: "Selected bookings" })).toHaveCount(0);
  await table.getByRole("checkbox", { name: "Select all your bookings on this page" }).click();
  await expect(
    page.getByRole("region", { name: "Selected bookings" }).getByText("1 selected"),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  expect(errors).toEqual([]);
});

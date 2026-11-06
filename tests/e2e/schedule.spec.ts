import { expect, test } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";

import * as schema from "@/server/db/schema";

import { collectConsoleErrors, expectNoAxeViolations } from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

// Needs the local Supabase stack (Auth, Mailpit) and DATABASE_URL (.env.local).

const businesses = liveBusinesses();
const { db } = businesses;
test.afterAll(() => businesses.cleanup());

test("an owner edits a staff member's weekly hours", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "hours");
  // Open Monday to Friday, so Saturday hours come with a warning.
  await db
    .update(schema.businesses)
    .set({
      settings: sql`${schema.businesses.settings} || ${JSON.stringify({
        openingHours: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          start: "09:00",
          end: "17:00",
        })),
      })}::jsonb`,
    })
    .where(eq(schema.businesses.id, fixture.business.id));

  await page.goto("/app/staff");
  await page.getByRole("button", { name: "Edit Mia" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("tab", { name: "Hours" }).click();
  await expect(sheet.getByRole("heading", { name: "Mia’s weekly hours" })).toBeVisible();
  await expect(sheet.getByText("Opening hours: Mon – Fri, 09:00 – 17:00")).toBeVisible();
  // No rules yet: the editor starts from Monday to Friday, 09:00 – 17:00.
  const saturday = sheet.getByRole("switch", { name: "Mia works Saturday" });
  await expect(saturday).not.toBeChecked();

  await saturday.focus();
  await page.keyboard.press("Space");
  await expect(saturday).toBeChecked();
  await sheet.getByLabel("Saturday ends").selectOption("13:00");
  await sheet.getByLabel("Friday starts").selectOption("10:00");
  await expect(sheet.getByText("Outside opening hours (allowed)")).toBeVisible();
  await expect(sheet.getByText("Saturday: the business is closed that day.")).toBeVisible();
  await expect(sheet.getByText(/^43 h a week\./)).toBeVisible();
  await expectNoAxeViolations(page);

  await sheet.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByText("Saved Mia's hours")).toBeVisible();

  const rules = await db
    .select({
      weekday: schema.availabilityRules.weekday,
      startTime: schema.availabilityRules.startTime,
      endTime: schema.availabilityRules.endTime,
    })
    .from(schema.availabilityRules)
    .where(eq(schema.availabilityRules.staffId, fixture.staff.id))
    .orderBy(schema.availabilityRules.weekday);
  expect(rules).toEqual([
    { weekday: 1, startTime: "09:00:00", endTime: "17:00:00" },
    { weekday: 2, startTime: "09:00:00", endTime: "17:00:00" },
    { weekday: 3, startTime: "09:00:00", endTime: "17:00:00" },
    { weekday: 4, startTime: "09:00:00", endTime: "17:00:00" },
    { weekday: 5, startTime: "10:00:00", endTime: "17:00:00" },
    { weekday: 6, startTime: "09:00:00", endTime: "13:00:00" },
  ]);

  // Still there after a reload.
  await page.reload();
  await page.getByRole("button", { name: "Edit Mia" }).click();
  await page.getByRole("dialog").getByRole("tab", { name: "Hours" }).click();
  await expect(
    page.getByRole("dialog").getByRole("switch", { name: "Mia works Saturday" }),
  ).toBeChecked();
  await expect(page.getByRole("dialog").getByLabel("Saturday ends")).toHaveValue("13:00");
  expect(errors).toEqual([]);
});

test("a staff member adds their own time off", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { fixture, email } = await businesses.signInWithBusiness(page, "staff", "timeoff");
  // The fixture's staff member is this user.
  const [user] = await db.execute<{ id: string }>(
    sql`select id from auth.users where email = ${email}`,
  );
  await db
    .update(schema.staff)
    .set({ userId: user!.id, email })
    .where(eq(schema.staff.id, fixture.staff.id));

  await page.goto("/app/staff");
  const card = page.getByRole("button", { name: "Open your schedule, Mia" });
  await expect(card).not.toContainText("Next time off");
  await card.click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("tab", { name: "Time off" }).click();
  await expect(sheet.getByText("No time off planned for Mia.")).toBeVisible();

  await sheet.getByRole("button", { name: "Add time off" }).click();
  const form = sheet.getByRole("form", { name: "Add time off" });
  await expect(form.getByRole("switch", { name: "All day" })).toBeChecked();
  await form.getByLabel("First day").fill("2030-03-14");
  await form.getByLabel("Last day").fill("2030-03-15");
  await form.getByLabel("Reason").fill("Conference");
  await expect(form.getByText("Times are in the business’s timezone (Asia/Manila).")).toBeVisible();
  await expectNoAxeViolations(page);
  await form.getByRole("button", { name: "Add time off" }).click();

  await expect(page.getByText("Time off added")).toBeVisible();
  await expect(sheet.getByText("Thu 14 – Fri 15 Mar", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Conference", { exact: true })).toBeVisible();

  // Stored from Manila midnights (UTC+8).
  const [row] = await db
    .select()
    .from(schema.timeOff)
    .where(
      and(
        eq(schema.timeOff.staffId, fixture.staff.id),
        eq(schema.timeOff.businessId, fixture.business.id),
      ),
    );
  expect(row).toMatchObject({
    allDay: true,
    reason: "Conference",
    startsAt: new Date("2030-03-13T16:00:00Z"),
    endsAt: new Date("2030-03-15T16:00:00Z"),
  });

  await page.keyboard.press("Escape");
  await expect(card).toContainText("Next time off: Thu 14 – Fri 15 Mar");
  expect(errors).toEqual([]);
});

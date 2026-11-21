import { expect, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "@/server/db/schema";

import { connectTestDb, createFixtureBusiness } from "./db";

/*
 * Playwright helpers for the public booking page and the manage page:
 * bookable businesses straight in the database (no sign-in), and steps a
 * customer takes. Call `cleanup()` in afterAll.
 */

export type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;

export const CRIMSON = "#BE123C";

export function bookableBusinesses() {
  const { db, close } = connectTestDb();
  const fixtures: Fixture[] = [];

  return {
    db,
    /** A live business: Mia does the haircut (45 min + 15 min clean-up), 08:00–20:00 daily. */
    async create(): Promise<Fixture> {
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
          phone: "+63 2 8000 0000",
          contactEmail: "frontdesk@example.com",
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
    },
    async cleanup() {
      for (const fixture of fixtures) await fixture.cleanup();
      await close();
    },
  };
}

/** The visible one of a button that appears in both the phone bar and the desktop card. */
export const visibleButton = (page: Page, name: string) =>
  page.locator("button:visible", { hasText: name }).first();

export const timeChips = (page: Page) => page.getByRole("radio", { name: /^\d{2}:\d{2}$/ });

/** Pick a card or chip the way a customer does: tap its label (the radio is visually hidden). */
export async function choose(radio: Locator) {
  await radio.locator("xpath=ancestor::label[1]").click();
  await expect(radio).toBeChecked();
}

export async function pressContinue(page: Page) {
  const button = visibleButton(page, "Continue");
  await expect(button).toBeEnabled();
  await button.focus();
  await page.keyboard.press("Enter");
}

/** Service and staff steps, landing on the times. */
export async function toTimes(page: Page, fixture: Fixture) {
  await page.goto(`/b/${fixture.business.slug}`);
  await choose(page.getByRole("radio", { name: /Haircut/ }));
  await pressContinue(page);
  await expect(page).toHaveURL(/step=staff/);
  await pressContinue(page);
  await expect(page).toHaveURL(/step=time/);
  await expect(timeChips(page).first()).toBeAttached();
}

/** A whole booking through the page; returns its confirmation URL and start. */
export async function bookThroughPage(page: Page, fixture: Fixture, chip = 1) {
  await toTimes(page, fixture);
  await choose(timeChips(page).nth(chip));
  const start = await timeChips(page).nth(chip).getAttribute("value");
  await pressContinue(page);
  await expect(page).toHaveURL(/step=details/);
  await page.getByLabel("Full name").fill("Rosa Cruz");
  await page.getByLabel("Email").fill(`rosa-${Date.now()}@example.com`);
  await visibleButton(page, "Confirm booking").click();
  await expect(page).toHaveURL(new RegExp(`/b/${fixture.business.slug}/booked/`));
  return { start: start! };
}

/**
 * Each test books as its own visitor: the public endpoints are rate-limited
 * per IP (src/server/rate-limit.ts), and a whole suite from localhost would
 * otherwise look like one person booking dozens of times.
 */
export async function asNewVisitor(page: Page) {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.${octet()}.${octet()}`,
  });
}

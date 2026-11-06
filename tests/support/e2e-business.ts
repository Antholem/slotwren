import { expect, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";

import * as schema from "@/server/db/schema";

import { bookingValues, connectTestDb, createFixtureBusiness } from "./db";
import { signInWithMagicLink, uniqueEmail } from "./e2e";

type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;

/**
 * Playwright setup that skips the wizard (it has its own test): sign up, then
 * give the user a live business directly in the database with one staff
 * member and "Haircut", booked once. Call `cleanup()` in afterAll.
 */
export function liveBusinesses() {
  const { db, close } = connectTestDb();
  const fixtures: Fixture[] = [];

  return {
    db,
    async signInWithBusiness(page: Page, role: "owner" | "staff", label = "e2e") {
      const email = uniqueEmail(`${label}-${role}`);
      await signInWithMagicLink(page, email);
      // Let the sign-in redirects (callback → /app → /onboarding → step 1) settle.
      await expect(page).toHaveURL(/\/onboarding\/basics$/);
      await expect(
        page.getByRole("heading", { name: "Tell us about your business" }),
      ).toBeVisible();

      const fixture = await createFixtureBusiness(db);
      fixtures.push(fixture);
      await db
        .update(schema.businesses)
        .set({ onboardedAt: new Date(), setupStep: 4 })
        .where(eq(schema.businesses.id, fixture.business.id));
      const [user] = await db.execute<{ id: string }>(
        sql`select id from auth.users where email = ${email}`,
      );
      await db
        .insert(schema.memberships)
        .values({ businessId: fixture.business.id, userId: user!.id, role });
      await db.insert(schema.staffServices).values({
        businessId: fixture.business.id,
        staffId: fixture.staff.id,
        serviceId: fixture.service.id,
      });
      await db
        .insert(schema.bookings)
        .values(bookingValues(fixture, new Date("2030-05-01T01:00:00Z")));
      return { fixture, email };
    },
    async cleanup() {
      for (const fixture of fixtures) await fixture.cleanup();
      await close();
    },
  };
}

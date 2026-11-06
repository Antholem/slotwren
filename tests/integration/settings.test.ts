import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultWeek } from "@/lib/hours";
import type { BusinessSettingsInput } from "@/lib/validation/settings";
import type { Actor } from "@/server/catalog/services";
import { checkSettingsSlug, saveBusinessSettings } from "@/server/catalog/settings";
import { type RlsClaims, withRls } from "@/server/db/client";
import { updateBusinessSettings } from "@/server/db/queries/settings";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, createFixtureBusiness, pgErrorCode } from "../support/db";

/*
 * Settings → Business as real signed-in users: owners save, staff and other
 * businesses can't (catalog check and RLS), the database CHECKs hold even
 * without the app's validation, and grid and timezone changes do what the
 * form promises to existing hours, time off and bookings.
 */

describe("business settings", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let b: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let owner: Actor;
  let staffer: Actor;
  let otherOwner: Actor;
  let staffClaims: RlsClaims;

  const businessRow = async (id: string) =>
    (await db.select().from(schema.businesses).where(eq(schema.businesses.id, id)))[0]!;

  /** The Business tab as the form submits it, from the saved row. */
  async function formFor(id: string): Promise<BusinessSettingsInput> {
    const row = await businessRow(id);
    return {
      name: row.name,
      slug: row.slug,
      timezone: row.timezone,
      currency: row.currency,
      brandColor: row.brandColor,
      logoUrl: row.logoUrl,
      openingHours: defaultWeek(),
      rules: {
        minNoticeMin: row.minNoticeMin,
        maxDaysAhead: row.maxDaysAhead,
        slotIntervalMin: row.slotIntervalMin,
        cancellationWindowHours: row.cancellationWindowHours,
      },
      roundStaffHours: false,
      confirmTimezone: false,
    };
  }

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    const [ownerUser, staffUser, ownerUserB] = await Promise.all([
      users.create("settings-owner-a"),
      users.create("settings-staff-a"),
      users.create("settings-owner-b"),
    ]);
    staffClaims = staffUser;
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerUser.sub, role: "owner" },
      { businessId: a.business.id, userId: staffUser.sub, role: "staff" },
      { businessId: b.business.id, userId: ownerUserB.sub, role: "owner" },
    ]);
    owner = { claims: ownerUser, businessId: a.business.id, role: "owner" };
    staffer = { claims: staffUser, businessId: a.business.id, role: "staff" };
    otherOwner = { claims: ownerUserB, businessId: b.business.id, role: "owner" };
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  describe("permissions", () => {
    it("an owner saves the business tab", async () => {
      const form = await formFor(a.business.id);
      const result = await saveBusinessSettings(owner, {
        ...form,
        name: "Lumen Studio Makati",
        currency: "PHP",
        brandColor: "#7c3aed",
        openingHours: defaultWeek(),
        rules: {
          minNoticeMin: 60,
          maxDaysAhead: 30,
          slotIntervalMin: 15,
          cancellationWindowHours: 48,
        },
      });
      expect(result).toEqual({
        ok: true,
        data: { slugChanged: false, roundedRanges: 0, movedTimeOff: 0 },
      });
      const row = await businessRow(a.business.id);
      expect(row).toMatchObject({
        name: "Lumen Studio Makati",
        currency: "PHP",
        brandColor: "#7C3AED",
        minNoticeMin: 60,
        maxDaysAhead: 30,
        slotIntervalMin: 15,
        cancellationWindowHours: 48,
      });
      expect(row.settings.openingHours).toHaveLength(5);
      expect(row.settings.openingHours?.[0]).toEqual({ weekday: 1, start: "09:00", end: "17:00" });
    });

    it("keeps other settings when saving opening hours", async () => {
      await db
        .update(schema.businesses)
        .set({
          settings: sql`${schema.businesses.settings} || '{"notifications":{"ownerNewBookingEmail":true}}'::jsonb`,
        })
        .where(eq(schema.businesses.id, a.business.id));
      expect((await saveBusinessSettings(owner, await formFor(a.business.id))).ok).toBe(true);
      expect((await businessRow(a.business.id)).settings.notifications).toEqual({
        ownerNewBookingEmail: true,
      });
    });

    it("staff can't change settings", async () => {
      const before = await businessRow(a.business.id);
      const result = await saveBusinessSettings(staffer, {
        ...(await formFor(a.business.id)),
        name: "Staff Was Here",
      });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect((await businessRow(a.business.id)).name).toBe(before.name);
    });

    it("RLS refuses staff too, below the server function", async () => {
      const row = await businessRow(a.business.id);
      const result = await updateBusinessSettings(
        staffClaims,
        a.business.id,
        {
          name: "Staff Was Here",
          slug: row.slug,
          timezone: row.timezone,
          currency: row.currency,
          brandColor: row.brandColor,
          logoUrl: row.logoUrl,
          openingHours: [],
          minNoticeMin: 0,
          maxDaysAhead: 1,
          slotIntervalMin: 30,
          cancellationWindowHours: 0,
        },
        { rounded: [], moveTimeOff: null, now: new Date() },
      );
      expect(result.saved).toBe(false);
      expect((await businessRow(a.business.id)).name).toBe(row.name);
    });

    it("an owner can't change another business", async () => {
      const before = await businessRow(a.business.id);
      // otherOwner's actor names their own business; point it at A's id.
      const result = await saveBusinessSettings(
        { ...otherOwner, businessId: a.business.id },
        { ...(await formFor(a.business.id)), name: "Hijacked" },
      );
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
      expect((await businessRow(a.business.id)).name).toBe(before.name);
    });

    it("plan and billing columns stay out of reach", async () => {
      const update = withRls(owner.claims, (tx) =>
        tx
          .update(schema.businesses)
          .set({ plan: "pro" })
          .where(eq(schema.businesses.id, a.business.id)),
      );
      await expect(update).rejects.toSatisfy((e) => pgErrorCode(e) === "42501");
    });
  });

  describe("booking link", () => {
    it("is checked for availability, ignoring the business's own", async () => {
      const own = (await businessRow(a.business.id)).slug;
      expect(await checkSettingsSlug(owner, own)).toEqual({ ok: true, data: { available: true } });
      expect(await checkSettingsSlug(owner, b.business.slug)).toEqual({
        ok: true,
        data: { available: false },
      });
      expect(await checkSettingsSlug(owner, "Not A Slug")).toMatchObject({ ok: false });
    });

    it("refuses a link another business has", async () => {
      const result = await saveBusinessSettings(owner, {
        ...(await formFor(a.business.id)),
        slug: b.business.slug,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "slug_taken", fieldErrors: { slug: [expect.any(String)] } },
      });
    });

    it("changes the link", async () => {
      const slug = `moved-${a.business.id.slice(0, 8)}`;
      const result = await saveBusinessSettings(owner, { ...(await formFor(a.business.id)), slug });
      expect(result).toMatchObject({ ok: true, data: { slugChanged: true } });
      expect((await businessRow(a.business.id)).slug).toBe(slug);
    });
  });

  describe("CHECK constraints", () => {
    // Straight to the database, past the app's validation.
    it.each([
      ["businesses_min_notice", { minNoticeMin: -1 }],
      ["businesses_max_days", { maxDaysAhead: 0 }],
      ["businesses_max_days", { maxDaysAhead: 366 }],
      ["businesses_slot_interval", { slotIntervalMin: 20 }],
      ["businesses_cancel_window", { cancellationWindowHours: -1 }],
      ["businesses_currency_code", { currency: "usd" }],
      ["businesses_brand_color_hex", { brandColor: "teal" }],
      ["businesses_slug_format", { slug: "-bad-" }],
    ])("%s refuses %o", async (constraint, change) => {
      const update = withRls(owner.claims, (tx) =>
        tx.update(schema.businesses).set(change).where(eq(schema.businesses.id, a.business.id)),
      );
      await expect(update).rejects.toSatisfy((e) => {
        const err = e as { cause?: { code?: string; constraint_name?: string } };
        return err.cause?.code === "23514" && err.cause.constraint_name === constraint;
      });
    });

    it("accepts the edges", async () => {
      await withRls(owner.claims, (tx) =>
        tx
          .update(schema.businesses)
          .set({
            minNoticeMin: 0,
            maxDaysAhead: 365,
            slotIntervalMin: 15,
            cancellationWindowHours: 0,
          })
          .where(eq(schema.businesses.id, a.business.id)),
      );
      await withRls(owner.claims, (tx) =>
        tx
          .update(schema.businesses)
          .set({ maxDaysAhead: 1, slotIntervalMin: 30 })
          .where(eq(schema.businesses.id, a.business.id)),
      );
    });

    it("the server function refuses what the CHECKs would", async () => {
      const form = await formFor(a.business.id);
      for (const rules of [
        { ...form.rules, slotIntervalMin: 20 },
        { ...form.rules, maxDaysAhead: 400 },
        { ...form.rules, minNoticeMin: -60 },
        { ...form.rules, cancellationWindowHours: -2 },
      ]) {
        expect(await saveBusinessSettings(owner, { ...form, rules })).toMatchObject({
          ok: false,
          error: { code: "invalid_input" },
        });
      }
      expect(await saveBusinessSettings(owner, { ...form, currency: "usd" })).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
    });
  });

  describe("changing the slot interval", () => {
    const rulesOf = () =>
      db
        .select({
          start: schema.availabilityRules.startTime,
          end: schema.availabilityRules.endTime,
        })
        .from(schema.availabilityRules)
        .where(eq(schema.availabilityRules.staffId, a.staff.id))
        .orderBy(schema.availabilityRules.startTime);

    beforeAll(async () => {
      await db
        .update(schema.businesses)
        .set({ slotIntervalMin: 15 })
        .where(eq(schema.businesses.id, a.business.id));
      await db.insert(schema.availabilityRules).values([
        {
          businessId: a.business.id,
          staffId: a.staff.id,
          weekday: 2,
          startTime: "09:15",
          endTime: "12:00",
        },
        {
          businessId: a.business.id,
          staffId: a.staff.id,
          weekday: 2,
          startTime: "13:00",
          endTime: "17:45",
        },
        {
          businessId: a.business.id,
          staffId: a.staff.id,
          weekday: 3,
          startTime: "18:15",
          endTime: "18:45",
        },
        {
          businessId: a.business.id,
          staffId: a.staff.id,
          weekday: 4,
          startTime: "09:00",
          endTime: "17:00",
        },
      ]);
    });

    it("refuses a 30-minute grid while staff hours are off it", async () => {
      const form = await formFor(a.business.id);
      const result = await saveBusinessSettings(owner, {
        ...form,
        rules: { ...form.rules, slotIntervalMin: 30 },
      });
      expect(result).toMatchObject({ ok: false, error: { code: "hours_off_grid" } });
      expect(result.ok ? "" : result.error.message).toContain("Mia has hours");
      expect((await businessRow(a.business.id)).slotIntervalMin).toBe(15);
      expect(await rulesOf()).toHaveLength(4);
    });

    it("rounds them inward when the owner asks", async () => {
      const form = await formFor(a.business.id);
      const result = await saveBusinessSettings(owner, {
        ...form,
        rules: { ...form.rules, slotIntervalMin: 30 },
        roundStaffHours: true,
      });
      expect(result).toMatchObject({ ok: true, data: { roundedRanges: 3 } });
      expect((await businessRow(a.business.id)).slotIntervalMin).toBe(30);
      expect(await rulesOf()).toEqual([
        { start: "09:00:00", end: "17:00:00" }, // already on the grid
        { start: "09:30:00", end: "12:00:00" },
        { start: "13:00:00", end: "17:30:00" },
        // 18:15 – 18:45 had nothing left on the grid: removed.
      ]);
    });

    it("going finer needs nothing", async () => {
      const form = await formFor(a.business.id);
      expect(
        await saveBusinessSettings(owner, {
          ...form,
          rules: { ...form.rules, slotIntervalMin: 15 },
        }),
      ).toMatchObject({ ok: true, data: { roundedRanges: 0 } });
    });
  });

  describe("changing the timezone", () => {
    let offId: string;
    let pastOffId: string;
    let bookingId: string;
    const now = new Date("2026-11-07T00:00:00Z");

    beforeAll(async () => {
      await db
        .update(schema.businesses)
        .set({ timezone: "Asia/Manila" })
        .where(eq(schema.businesses.id, a.business.id));
      // All day Fri 20 Nov in Manila (UTC+8), and one last month.
      const [upcoming, past] = await db
        .insert(schema.timeOff)
        .values([
          {
            businessId: a.business.id,
            staffId: a.staff.id,
            startsAt: new Date("2026-11-19T16:00:00Z"),
            endsAt: new Date("2026-11-20T16:00:00Z"),
            allDay: true,
          },
          {
            businessId: a.business.id,
            staffId: a.staff.id,
            startsAt: new Date("2026-10-01T16:00:00Z"),
            endsAt: new Date("2026-10-02T16:00:00Z"),
            allDay: true,
          },
        ])
        .returning({ id: schema.timeOff.id });
      offId = upcoming!.id;
      pastOffId = past!.id;
      const [booking] = await db
        .insert(schema.bookings)
        .values(bookingValues(a, new Date("2026-11-25T02:00:00Z")))
        .returning({ id: schema.bookings.id });
      bookingId = booking!.id;
    });

    const timeOffRow = async (id: string) =>
      (await db.select().from(schema.timeOff).where(eq(schema.timeOff.id, id)))[0]!;

    it("needs the owner's confirmation", async () => {
      const result = await saveBusinessSettings(
        owner,
        { ...(await formFor(a.business.id)), timezone: "Europe/London" },
        now,
      );
      expect(result).toMatchObject({ ok: false, error: { code: "confirm_timezone" } });
      expect((await businessRow(a.business.id)).timezone).toBe("Asia/Manila");
    });

    it("moves upcoming time off to the same local dates, never bookings", async () => {
      const result = await saveBusinessSettings(
        owner,
        { ...(await formFor(a.business.id)), timezone: "Europe/London", confirmTimezone: true },
        now,
      );
      expect(result).toMatchObject({ ok: true, data: { movedTimeOff: 1 } });
      expect((await businessRow(a.business.id)).timezone).toBe("Europe/London");

      // Still all of Fri 20 Nov, now in London (UTC+0 in November).
      expect(await timeOffRow(offId)).toMatchObject({
        startsAt: new Date("2026-11-20T00:00:00Z"),
        endsAt: new Date("2026-11-21T00:00:00Z"),
      });
      // Past time off is history: left alone.
      expect((await timeOffRow(pastOffId)).startsAt).toEqual(new Date("2026-10-01T16:00:00Z"));
      // The customer was promised that exact moment.
      const [booking] = await db
        .select({ startsAt: schema.bookings.startsAt })
        .from(schema.bookings)
        .where(eq(schema.bookings.id, bookingId));
      expect(booking!.startsAt).toEqual(new Date("2026-11-25T02:00:00Z"));
    });

    it("lands on the right side of a DST change", async () => {
      // London → New York, for a day New York springs forward (23 hours).
      const [entry] = await db
        .insert(schema.timeOff)
        .values({
          businessId: a.business.id,
          staffId: a.staff.id,
          startsAt: new Date("2027-03-14T00:00:00Z"), // Sun 14 Mar, London midnight
          endsAt: new Date("2027-03-15T00:00:00Z"),
          allDay: true,
        })
        .returning({ id: schema.timeOff.id });
      const result = await saveBusinessSettings(
        owner,
        { ...(await formFor(a.business.id)), timezone: "America/New_York", confirmTimezone: true },
        now,
      );
      expect(result.ok).toBe(true);
      // New York springs forward on 14 Mar 2027: midnight is EST, the next is EDT.
      expect(await timeOffRow(entry!.id)).toMatchObject({
        startsAt: new Date("2027-03-14T05:00:00Z"),
        endsAt: new Date("2027-03-15T04:00:00Z"),
      });
    });
  });
});

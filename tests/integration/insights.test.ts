import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { insightWeeks } from "@/lib/insights";
import { zonedInstant } from "@/lib/time-off";
import type { Actor } from "@/server/catalog/services";
import { getInsights } from "@/server/db/queries/insights";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, countQueries, createFixtureBusiness } from "../support/db";

/*
 * Insights aggregates for a New York business. "Today" is Wed 4 Nov 2026, so
 * the 12-week range ends with the week of Mon 2 Nov; the week before (Mon 26
 * Oct to Sun 1 Nov) holds the night the clocks went back and is 169 hours
 * long. Both 01:30s that Sunday belong to it, and to the 01:00 hour.
 */

const NY = "America/New_York";
const at = (date: string, time: string) => zonedInstant(date, time, NY);
const TODAY = "2026-11-04";
const WEEKS = insightWeeks("12w", TODAY, NY);

type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;

describe("insights", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Fixture;
  let b: Fixture;
  let owner: Actor;
  let ownerB: Actor;
  let jonahId: string;
  let colourId: string;

  const read = (actor: Actor, staffId: string | null = null, bounds = WEEKS.bounds) =>
    getInsights(actor.claims, actor.businessId, { bounds, zone: NY, staffId });

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    await db
      .update(schema.businesses)
      .set({ timezone: NY })
      .where(eq(schema.businesses.id, a.business.id));
    const [ownerUser, ownerUserB] = await Promise.all([
      users.create("ins-owner"),
      users.create("ins-owner-b"),
    ]);
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerUser.sub, role: "owner" },
      { businessId: b.business.id, userId: ownerUserB.sub, role: "owner" },
    ]);
    const [jonah] = await db
      .insert(schema.staff)
      .values({ businessId: a.business.id, name: "Jonah", color: "violet" })
      .returning({ id: schema.staff.id });
    jonahId = jonah!.id;
    const [colour] = await db
      .insert(schema.services)
      .values({ businessId: a.business.id, name: "Colour", durationMin: 90, priceCents: 8000 })
      .returning({ id: schema.services.id });
    colourId = colour!.id;

    const v = (startsAt: Date, overrides: Partial<typeof schema.bookings.$inferInsert> = {}) =>
      bookingValues(a, startsAt, { status: "completed", ...overrides });
    await db.insert(schema.bookings).values([
      // The DST week (bucket 11): its first instant, both 01:30s, and 23:30 on Sunday
      // (04:30 UTC on Monday: UTC would put it in the next week).
      v(at("2026-10-26", "00:00")),
      v(new Date("2026-11-01T05:30:00Z")), // 01:30 EDT
      v(new Date("2026-11-01T06:30:00Z"), { staffId: jonahId }), // 01:30 EST, the second one
      v(at("2026-11-01", "23:30"), { source: "ai" }),
      // This week (bucket 12)
      v(at("2026-11-02", "00:15"), { serviceId: colourId, priceCents: 8000 }),
      v(at("2026-11-03", "10:00"), { status: "no_show" }),
      v(at("2026-11-05", "14:00"), { status: "confirmed", source: "widget" }),
      v(at("2026-11-03", "11:00"), { status: "cancelled" }), // never counts
      // The week before the DST one (bucket 10): Sunday 23:59, a minute before it starts
      v(at("2026-10-25", "23:59")),
      // Outside the 12 weeks
      v(at("2026-08-09", "10:00")),
      v(at("2026-11-09", "09:00"), { status: "confirmed" }),
    ]);
    await db.insert(schema.bookings).values(bookingValues(b, at("2026-11-03", "10:00")));
    owner = { claims: ownerUser, businessId: a.business.id, role: "owner" };
    ownerB = { claims: ownerUserB, businessId: b.business.id, role: "owner" };
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  it("covers 12 Monday-start weeks, the DST one 169 hours long", () => {
    expect(WEEKS.mondays).toHaveLength(12);
    expect(WEEKS.mondays.at(-1)).toBe("2026-11-02");
    expect(WEEKS.mondays.at(-2)).toBe("2026-10-26");
    const hours = (i: number) =>
      (WEEKS.bounds[i + 1]!.getTime() - WEEKS.bounds[i]!.getTime()) / 3_600_000;
    expect(hours(10)).toBe(169);
    expect(hours(11)).toBe(168);
  });

  it("counts bookings, revenue and no-shows per local week", async () => {
    const { weeks, totals } = await read(owner);
    expect(weeks).toHaveLength(12);
    expect(weeks[9]).toEqual({ bookings: 1, revenueCents: 3500, noShows: 0, marked: 1, ai: 0 });
    expect(weeks[10]).toEqual({ bookings: 4, revenueCents: 14000, noShows: 0, marked: 4, ai: 1 });
    // 00:15 colour ($80), a no-show (no revenue), an upcoming widget booking; the cancelled one is out.
    expect(weeks[11]).toEqual({
      bookings: 3,
      revenueCents: 8000 + 3500,
      noShows: 1,
      marked: 2,
      ai: 0,
    });
    expect(weeks.slice(0, 9).every((w) => w.bookings === 0)).toBe(true);
    expect(totals).toEqual({
      bookings: 8,
      revenueCents: 3500 + 14000 + 11500,
      noShows: 1,
      marked: 7,
      ai: 1,
    });
  });

  it("puts each booking in its local weekday and hour, both 01:30s in the 01:00 hour", async () => {
    const { heat } = await read(owner);
    const cell = (weekday: number, hour: number) =>
      heat.find((h) => h.weekday === weekday && h.hour === hour)?.bookings ?? 0;
    expect(cell(7, 1)).toBe(2); // Sunday 1 Nov, 01:30 twice
    expect(cell(7, 23)).toBe(2); // Sunday 23:30 (1 Nov) and 23:59 (25 Oct)
    expect(cell(1, 0)).toBe(2); // Monday 00:00 (26 Oct) and 00:15 (2 Nov)
    expect(cell(2, 10)).toBe(1); // Tuesday's no-show; the cancelled 11:00 is out
    expect(cell(4, 14)).toBe(1);
    expect(heat.reduce((sum, h) => sum + h.bookings, 0)).toBe(8);
  });

  it("splits by source and ranks services", async () => {
    const { bySource, topServices } = await read(owner);
    expect(bySource).toEqual([
      { source: "page", bookings: 6 },
      expect.objectContaining({ bookings: 1 }),
      expect.objectContaining({ bookings: 1 }),
    ]);
    expect(new Set(bySource.map((s) => s.source))).toEqual(new Set(["page", "ai", "widget"]));
    expect(topServices).toEqual([
      { id: a.service.id, name: "Haircut", priceCents: 3500, bookings: 7, revenueCents: 6 * 3500 },
      { id: colourId, name: "Colour", priceCents: 8000, bookings: 1, revenueCents: 8000 },
    ]);
  });

  it("filters by staff member", async () => {
    const { totals, heat } = await read(owner, jonahId);
    expect(totals.bookings).toBe(1);
    expect(heat).toEqual([{ weekday: 7, hour: 1, bookings: 1 }]);
  });

  it("follows the range: 4 weeks, and this year", async () => {
    const four = insightWeeks("4w", TODAY, NY);
    expect(four.mondays).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
    expect((await read(owner, null, four.bounds)).totals.bookings).toBe(8);
    const year = insightWeeks("year", TODAY, NY);
    expect(year.mondays[0]).toBe("2025-12-29"); // the week holding 1 January
    expect(year.mondays.at(-1)).toBe("2026-11-02");
    expect((await read(owner, null, year.bounds)).totals.bookings).toBe(9); // + 9 August
  });

  it("is a fixed handful of queries, and empty for another business", async () => {
    const { queries } = await countQueries(() => read(owner));
    expect(queries).toBeLessThanOrEqual(9);
    const other = await read({ ...ownerB, businessId: a.business.id });
    expect(other.totals.bookings).toBe(0);
    expect(other.hasBookings).toBe(false);
    expect(other.heat).toEqual([]);
  });
});

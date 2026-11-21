import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { zonedInstant } from "@/lib/time-off";
import { todayRanges } from "@/lib/today";
import { BOOKING_MESSAGES, recordOutcome } from "@/server/booking/service";
import type { Actor } from "@/server/catalog/services";
import { getToday } from "@/server/db/queries/today";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * The Today page's data: stat aggregates computed in the business timezone
 * (New York, the week after clocks went back on Sun 1 Nov 2026), staff
 * scoping, and the Complete / No-show path through the booking service.
 *
 * NOW is Wed 4 Nov 2026 14:30 EST (19:30Z). This week runs Mon 2 Nov 00:00
 * EST (05:00Z) to Mon 9 Nov; last week from Mon 26 Oct 00:00 EDT (04:00Z),
 * 25 hours longer than UTC thinks because of the change.
 */

const NY = "America/New_York";
const at = (date: string, time: string) => zonedInstant(date, time, NY);
const NOW = at("2026-11-04", "14:30");

type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;

describe("Today", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Fixture;
  let b: Fixture;
  let jonahId: string;
  let owner: Actor;
  let staffer: Actor; // Jonah's login
  let ownerB: Actor;

  const insert = (
    startsAt: Date,
    status: (typeof schema.bookingStatusEnum.enumValues)[number] = "confirmed",
    overrides: Partial<typeof schema.bookings.$inferInsert> = {},
  ) =>
    db
      .insert(schema.bookings)
      .values(bookingValues(a, startsAt, { status, ...overrides }))
      .returning({ id: schema.bookings.id })
      .then((rows) => rows[0]!.id);

  const read = (actor: Actor, now = NOW) =>
    getToday(actor.claims, {
      businessId: actor.businessId,
      role: actor.role,
      ranges: todayRanges(now, NY),
      now,
    });

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    await db
      .update(schema.businesses)
      .set({ timezone: NY })
      .where(eq(schema.businesses.id, a.business.id));
    const [ownerUser, staffUser, ownerUserB] = await Promise.all([
      users.create("today-owner-a"),
      users.create("today-staff-a"),
      users.create("today-owner-b"),
    ]);
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerUser.sub, role: "owner" },
      { businessId: a.business.id, userId: staffUser.sub, role: "staff" },
      { businessId: b.business.id, userId: ownerUserB.sub, role: "owner" },
    ]);
    await db
      .update(schema.staff)
      .set({ userId: ownerUser.sub })
      .where(eq(schema.staff.id, a.staff.id));
    const [jonah] = await db
      .insert(schema.staff)
      .values({
        businessId: a.business.id,
        name: "Jonah",
        color: "violet",
        sortOrder: 1,
        userId: staffUser.sub,
      })
      .returning({ id: schema.staff.id });
    jonahId = jonah!.id;
    // Wednesday (3): Mia 09:00–17:00, Jonah 09:00–13:00.
    await db.insert(schema.availabilityRules).values([
      {
        businessId: a.business.id,
        staffId: a.staff.id,
        weekday: 3,
        startTime: "09:00",
        endTime: "17:00",
      },
      {
        businessId: a.business.id,
        staffId: jonahId,
        weekday: 3,
        startTime: "09:00",
        endTime: "13:00",
      },
      {
        businessId: a.business.id,
        staffId: jonahId,
        weekday: 4,
        startTime: "10:00",
        endTime: "18:00",
      },
    ]);

    owner = { claims: ownerUser, businessId: a.business.id, role: "owner" };
    staffer = { claims: staffUser, businessId: a.business.id, role: "staff" };
    ownerB = { claims: ownerUserB, businessId: b.business.id, role: "owner" };
  });

  beforeEach(async () => {
    await db.delete(schema.bookings).where(eq(schema.bookings.businessId, a.business.id));
    await db.delete(schema.bookings).where(eq(schema.bookings.businessId, b.business.id));
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  describe("stats", () => {
    beforeEach(async () => {
      // Today, Wed 4 Nov
      await insert(at("2026-11-04", "09:00"), "completed");
      await insert(at("2026-11-04", "11:00"), "no_show");
      await insert(at("2026-11-04", "14:00")); // in progress at 14:30
      await insert(at("2026-11-04", "16:00")); // to go
      await insert(at("2026-11-04", "17:00"), "cancelled"); // never counts
      await insert(at("2026-11-04", "23:00")); // 04:00Z on the 5th, still today locally
      // This week, not today
      await insert(at("2026-11-03", "23:00")); // 04:00Z on the 4th: UTC says today, it isn't
      await insert(at("2026-11-05", "00:00")); // tomorrow's first minute
      await insert(at("2026-11-02", "00:00")); // Monday's first minute
      // Last week
      await insert(at("2026-11-01", "23:30"), "no_show"); // 04:30Z Monday: UTC says this week
      await insert(at("2026-10-26", "00:00"), "completed"); // EDT Monday, 04:00Z
      // Neither week
      await insert(at("2026-10-25", "23:00"), "completed"); // 03:00Z Monday 26 Oct
      await insert(at("2026-09-20", "10:00"), "no_show"); // over 30 days ago
      // Another business on the same day never counts
      await db
        .insert(schema.bookings)
        .values(bookingValues(b, at("2026-11-04", "15:00"), { status: "confirmed" }));
    });

    it("counts today, this week and last week on local-midnight boundaries", async () => {
      const { stats, hasBookings } = await read(owner);
      expect(hasBookings).toBe(true);
      expect(stats.today).toEqual({ total: 5, done: 1, inProgress: 1, toGo: 2, noShow: 1 });
      expect(stats.week.total).toBe(8);
      expect(stats.week.lastWeek).toBe(2);
    });

    it("estimates revenue from booked prices, leaving out no-shows and cancellations", async () => {
      const { stats } = await read(owner);
      expect(stats.week.revenueCents).toBe(7 * 3500);
    });

    it("rates no-shows over marked appointments from the last 30 days", async () => {
      const { stats } = await read(owner);
      // Marked since 5 Oct: 4 Nov ×2, 1 Nov, 26 Oct, 25 Oct; no-shows: 4 Nov and 1 Nov.
      expect(stats.noShows).toEqual({ count: 2, marked: 5 });
    });

    it("moves with the clock: at 23:30 the late booking is in progress, not to go", async () => {
      const { stats } = await read(owner, at("2026-11-04", "23:30"));
      expect(stats.today).toMatchObject({ total: 5, inProgress: 1, toGo: 0 });
    });

    it("on Sunday 1 Nov (25 hours long) counts that day's bookings, not Monday's", async () => {
      const { stats } = await read(owner, at("2026-11-01", "12:00"));
      expect(stats.today.total).toBe(1); // the 23:30 no-show, after the repeated hour
      expect(stats.week.total).toBe(2); // 26 Oct and 1 Nov
      expect(stats.week.lastWeek).toBe(1); // 25 Oct
    });
  });

  describe("appointments and staff", () => {
    it("lists today's appointments in order, without cancelled ones", async () => {
      await insert(at("2026-11-04", "16:00"));
      await insert(at("2026-11-04", "09:00"), "completed");
      await insert(at("2026-11-04", "11:00"), "cancelled");
      await insert(at("2026-11-04", "23:30")); // runs past midnight: still today
      await insert(at("2026-11-05", "09:00"));
      const { appointments } = await read(owner);
      expect(appointments.map((x) => x.startsAt)).toEqual([
        at("2026-11-04", "09:00"),
        at("2026-11-04", "16:00"),
        at("2026-11-04", "23:30"),
      ]);
      expect(appointments[0]).toMatchObject({
        status: "completed",
        serviceName: "Haircut",
        customerName: "Ana Santos",
        staffId: a.staff.id,
      });
    });

    it("gives each staff member today's hours and time off", async () => {
      await db.insert(schema.timeOff).values({
        businessId: a.business.id,
        staffId: a.staff.id,
        startsAt: at("2026-11-04", "13:00"),
        endsAt: at("2026-11-04", "14:00"),
      });
      const { staff } = await read(owner);
      expect(staff.map((s) => s.name)).toEqual(["Mia", "Jonah"]);
      expect(staff[0]).toMatchObject({
        hours: [{ start: "09:00", end: "17:00" }],
        timeOff: [{ startsAt: at("2026-11-04", "13:00"), endsAt: at("2026-11-04", "14:00") }],
      });
      expect(staff[1]!.hours).toEqual([{ start: "09:00", end: "13:00" }]);
      await db.delete(schema.timeOff).where(eq(schema.timeOff.businessId, a.business.id));
    });

    it("shows staff only their own appointments and numbers", async () => {
      await insert(at("2026-11-04", "10:00"));
      await insert(at("2026-11-04", "11:00"), "confirmed", { staffId: jonahId });
      await insert(at("2026-11-03", "11:00"), "completed", { staffId: jonahId });
      const mine = await read(staffer);
      expect(mine.scopeStaffId).toBe(jonahId);
      expect(mine.appointments).toHaveLength(1);
      expect(mine.appointments[0]!.staffId).toBe(jonahId);
      expect(mine.staff.map((s) => s.id)).toEqual([jonahId]);
      expect(mine.stats.today.total).toBe(1);
      expect(mine.stats.week.total).toBe(2);
      expect(mine.ai).toBeNull();
      expect(mine.setup).toBeNull();

      const all = await read(owner);
      expect(all.appointments).toHaveLength(2);
      expect(all.stats.week.total).toBe(3);
      expect(all.ai).not.toBeNull();
    });

    it("never reads another business's data, even when asked for it", async () => {
      await insert(at("2026-11-04", "10:00"));
      const other = await read({ ...ownerB, businessId: a.business.id });
      expect(other.appointments).toHaveLength(0);
      expect(other.staff).toHaveLength(0);
      expect(other.stats.today.total).toBe(0);
      expect(other.hasBookings).toBe(false);
    });

    it("has a setup checklist for a business with no bookings yet", async () => {
      const fresh = await read(owner);
      expect(fresh.hasBookings).toBe(false);
      expect(fresh.stats.today.total).toBe(0);
      expect(fresh.setup).toEqual({
        openingHours: false,
        services: true,
        team: true, // Mia and Jonah
        aiEnabled: false,
      });
    });
  });

  describe("recordOutcome", () => {
    const event = (bookingId: string) =>
      db
        .select({ type: schema.bookingEvents.type, actor: schema.bookingEvents.actor })
        .from(schema.bookingEvents)
        .where(eq(schema.bookingEvents.bookingId, bookingId));
    const status = async (bookingId: string) =>
      (
        await db
          .select({ status: schema.bookings.status })
          .from(schema.bookings)
          .where(eq(schema.bookings.id, bookingId))
      )[0]!.status;

    it("completes an appointment that has started, with an audit event", async () => {
      const id = await insert(at("2026-11-04", "14:00"));
      const result = await recordOutcome(owner, id, { outcome: "completed" }, { now: NOW });
      expect(result).toEqual({ ok: true, data: { id, status: "completed" } });
      expect(await status(id)).toBe("completed");
      expect(await event(id)).toEqual([{ type: "completed", actor: "staff" }]);
    });

    it("marks a no-show after the appointment ended, and frees the time", async () => {
      const id = await insert(at("2026-11-04", "11:00"));
      const result = await recordOutcome(owner, id, { outcome: "no_show" }, { now: NOW });
      expect(result.ok).toBe(true);
      expect(await status(id)).toBe("no_show");
      // No longer blocks the slot: someone else can be booked into it.
      await expect(insert(at("2026-11-04", "11:00"))).resolves.toBeTypeOf("string");
    });

    it("refuses before the appointment starts", async () => {
      const id = await insert(at("2026-11-04", "16:00"));
      const result = await recordOutcome(owner, id, { outcome: "completed" }, { now: NOW });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "too_early", message: BOOKING_MESSAGES.tooEarly },
      });
      expect(await status(id)).toBe("confirmed");
    });

    it("is idempotent for the same outcome and refuses to flip a settled one", async () => {
      const id = await insert(at("2026-11-04", "14:00"));
      await recordOutcome(owner, id, { outcome: "completed" }, { now: NOW });
      const again = await recordOutcome(owner, id, { outcome: "completed" }, { now: NOW });
      expect(again.ok).toBe(true);
      expect(await event(id)).toHaveLength(1);
      const flip = await recordOutcome(owner, id, { outcome: "no_show" }, { now: NOW });
      expect(flip).toMatchObject({ ok: false, error: { code: "not_active" } });
    });

    it("refuses cancelled bookings", async () => {
      const id = await insert(at("2026-11-04", "14:00"), "cancelled");
      const result = await recordOutcome(owner, id, { outcome: "completed" }, { now: NOW });
      expect(result).toMatchObject({ ok: false, error: { code: "not_active" } });
    });

    it("lets staff mark their own appointments, not a colleague's", async () => {
      const theirs = await insert(at("2026-11-04", "14:00"), "confirmed", { staffId: jonahId });
      const mias = await insert(at("2026-11-04", "13:00"));
      expect(
        (await recordOutcome(staffer, theirs, { outcome: "completed" }, { now: NOW })).ok,
      ).toBe(true);
      const result = await recordOutcome(staffer, mias, { outcome: "completed" }, { now: NOW });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(await status(mias)).toBe("confirmed");
    });

    it("can't reach another business's booking, and rejects bad input", async () => {
      const id = await insert(at("2026-11-04", "14:00"));
      const cross = await recordOutcome(ownerB, id, { outcome: "completed" }, { now: NOW });
      expect(cross).toMatchObject({ ok: false, error: { code: "not_found" } });
      const forged = await recordOutcome(
        { ...ownerB, businessId: a.business.id },
        id,
        { outcome: "completed" },
        { now: NOW },
      );
      expect(forged.ok).toBe(false);
      expect(await status(id)).toBe("confirmed");
      const bad = await recordOutcome(owner, id, { outcome: "paid" }, { now: NOW });
      expect(bad).toMatchObject({ ok: false, error: { code: "invalid_input" } });
      const badId = await recordOutcome(owner, "nope", { outcome: "completed" }, { now: NOW });
      expect(badId).toMatchObject({ ok: false, error: { code: "not_found" } });
    });
  });

  it("keeps rows scoped by business in the events table", async () => {
    const id = await insert(at("2026-11-04", "14:00"));
    await recordOutcome(owner, id, { outcome: "completed" }, { now: NOW });
    const rows = await db
      .select({ businessId: schema.bookingEvents.businessId })
      .from(schema.bookingEvents)
      .where(and(eq(schema.bookingEvents.bookingId, id)));
    expect(rows).toEqual([{ businessId: a.business.id }]);
  });
});

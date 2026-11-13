import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { zonedInstant } from "@/lib/time-off";
import { BOOKING_CODE_PATTERN } from "@/server/booking/codes";
import {
  BOOKING_MESSAGES,
  type BookingChannel,
  cancelBooking,
  createBooking,
  rescheduleBooking,
} from "@/server/booking/service";
import { hashToken } from "@/server/booking/tokens";
import type { Actor } from "@/server/catalog/services";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * The one booking write path against the real database: slot re-checks, the
 * no_double_booking constraint under concurrency, the audit trail, customers,
 * manage tokens, RLS for members, and businesses that try to reach each other.
 *
 * Business A (Manila, 15-minute grid): Mia (sort 0, the owner's row) and
 * Jonah (sort 1, a staff login), both 09:00–17:00 every day, both do the
 * fixture Haircut (45 min + 15 min buffer after, 35.00). Business B is a
 * second fixture with its own owner.
 */

const MANILA = "Asia/Manila";
const DAY = "2026-11-03"; // Tuesday
const at = (time: string, date = DAY) => zonedInstant(date, time, MANILA);
const NOW = new Date("2026-11-02T00:00:00Z"); // Mon 08:00 Manila, 26 h before 10:00 Tue

type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;

describe("booking service", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Fixture;
  let b: Fixture;
  let jonahId: string;
  let owner: Actor;
  let staffer: Actor; // Jonah's login
  let ownerB: Actor;

  const page = (fixture: Fixture): BookingChannel => ({
    kind: "public",
    businessId: fixture.business.id,
    source: "page",
  });

  let emails = 0;
  const customer = (name = "Rosa Cruz") => ({
    name,
    email: `rosa-${Date.now()}-${emails++}@example.com`,
  });

  const book = (startsAt: Date, overrides: Record<string, unknown> = {}, channel = page(a)) =>
    createBooking(
      channel,
      {
        serviceId: a.service.id,
        staffId: a.staff.id,
        startsAt: startsAt.toISOString(),
        customer: customer(),
        ...overrides,
      },
      { now: NOW },
    );

  /** Book or fail the test. */
  async function booked(startsAt: Date, overrides: Record<string, unknown> = {}) {
    const result = await book(startsAt, overrides);
    if (!result.ok) throw new Error(`booking failed: ${result.error.message}`);
    return result.data;
  }

  const row = async (id: string) =>
    (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0]!;
  const events = (id: string) =>
    db
      .select()
      .from(schema.bookingEvents)
      .where(eq(schema.bookingEvents.bookingId, id))
      .orderBy(schema.bookingEvents.createdAt);
  const activeAt = (startsAt: Date) =>
    db
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.businessId, a.business.id),
          eq(schema.bookings.startsAt, startsAt),
          inArray(schema.bookings.status, ["pending", "confirmed"]),
        ),
      );

  /**
   * Insert a conflicting booking in a transaction that stays open, so the
   * service's slot check can't see it. `release` commits it.
   */
  async function holdConflict(values: typeof schema.bookings.$inferInsert) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let ready!: () => void;
    const inserted = new Promise<void>((resolve) => (ready = resolve));
    const committed = db.transaction(async (tx) => {
      await tx.insert(schema.bookings).values(values);
      ready();
      await released;
    });
    await inserted;
    return {
      async release() {
        release();
        await committed;
      },
    };
  }

  /** Wait until some query is blocked on a lock (the service's insert or update). */
  async function untilSomeoneWaits() {
    for (let i = 0; i < 100; i++) {
      const [waiting] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock'`,
      );
      if (waiting!.n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("nobody waited on the lock");
  }

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    await db
      .update(schema.businesses)
      .set({ slotIntervalMin: 15 })
      .where(eq(schema.businesses.id, a.business.id));

    const [ownerUser, staffUser, ownerUserB] = await Promise.all([
      users.create("book-owner-a"),
      users.create("book-staff-a"),
      users.create("book-owner-b"),
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

    const everyDay = (businessId: string, staffId: string) =>
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        businessId,
        staffId,
        weekday,
        startTime: "09:00",
        endTime: "17:00",
      }));
    await db
      .insert(schema.availabilityRules)
      .values([
        ...everyDay(a.business.id, a.staff.id),
        ...everyDay(a.business.id, jonahId),
        ...everyDay(b.business.id, b.staff.id),
      ]);
    await db.insert(schema.staffServices).values([
      { businessId: a.business.id, staffId: a.staff.id, serviceId: a.service.id },
      { businessId: a.business.id, staffId: jonahId, serviceId: a.service.id },
      { businessId: b.business.id, staffId: b.staff.id, serviceId: b.service.id },
    ]);

    owner = { claims: ownerUser, businessId: a.business.id, role: "owner" };
    staffer = { claims: staffUser, businessId: a.business.id, role: "staff" };
    ownerB = { claims: ownerUserB, businessId: b.business.id, role: "owner" };
  });

  beforeEach(async () => {
    await db
      .delete(schema.bookings)
      .where(inArray(schema.bookings.businessId, [a.business.id, b.business.id]));
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  describe("createBooking", () => {
    it("books a slot: code, hashed token, price snapshot, buffers and an audit event", async () => {
      const result = await book(at("10:00"), { customerTimezone: "Europe/London" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const created = result.data;
      expect(created).toMatchObject({
        startsAt: at("10:00"),
        endsAt: at("10:45"),
        staffId: a.staff.id,
        staffName: "Mia",
        serviceName: "Haircut",
        priceCents: 3500,
      });
      expect(created.code).toMatch(BOOKING_CODE_PATTERN);
      expect(created.manageToken.length).toBeGreaterThanOrEqual(43);

      const saved = await row(created.id);
      expect(saved).toMatchObject({
        businessId: a.business.id,
        code: created.code,
        status: "confirmed",
        source: "page",
        priceCents: 3500,
        bufferedStart: at("10:00"),
        bufferedEnd: at("11:00"), // 15 min clean-up
        customerTimezone: "Europe/London",
        createdByUserId: null,
      });
      expect(saved.manageTokenHash).toBe(hashToken(created.manageToken));
      expect(saved.manageTokenHash).not.toContain(created.manageToken);

      expect(await events(created.id)).toEqual([
        expect.objectContaining({
          type: "created",
          actor: "customer",
          actorUserId: null,
          data: { source: "page", startsAt: at("10:00").toISOString(), staffId: a.staff.id },
        }),
      ]);
    });

    it("reuses a customer by email, ignoring case, without renaming them", async () => {
      const created = await booked(at("10:00"), {
        customer: { name: "Someone Else", email: a.customer.email.toUpperCase() },
      });
      expect((await row(created.id)).customerId).toBe(a.customer.id);
      const matches = await db
        .select({ name: schema.customers.name })
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.businessId, a.business.id),
            sql`lower(${schema.customers.email}) = lower(${a.customer.email})`,
          ),
        );
      expect(matches).toEqual([{ name: "Ana Santos" }]);
    });

    it("creates a new customer for a new email", async () => {
      const details = customer("Lea Reyes");
      const created = await booked(at("10:00"), {
        customer: { ...details, phone: "+63 917 000 0000" },
      });
      const [saved] = await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, (await row(created.id)).customerId));
      expect(saved).toMatchObject({
        businessId: a.business.id,
        name: "Lea Reyes",
        email: details.email,
        phone: "+63 917 000 0000",
      });
    });

    it("keeps the price it was booked at when the service price changes", async () => {
      const created = await booked(at("10:00"));
      await db
        .update(schema.services)
        .set({ priceCents: 9900 })
        .where(eq(schema.services.id, a.service.id));
      try {
        expect((await row(created.id)).priceCents).toBe(3500);
      } finally {
        await db
          .update(schema.services)
          .set({ priceCents: 3500 })
          .where(eq(schema.services.id, a.service.id));
      }
    });

    it('assigns someone for "any" and says who', async () => {
      const first = await booked(at("10:00"), { staffId: "any" });
      expect(first).toMatchObject({ staffId: a.staff.id, staffName: "Mia" }); // lower sort order
      const second = await booked(at("10:00"), { staffId: "any" });
      expect(second).toMatchObject({ staffId: jonahId, staffName: "Jonah" }); // Mia is taken
    });

    it("refuses times the slot engine doesn't offer", async () => {
      for (const startsAt of [at("08:00"), at("10:05"), at("16:30"), at("10:00", "2027-03-01")]) {
        // Before hours, off the grid, running past closing, beyond 60 days.
        const result = await book(startsAt);
        expect(result).toEqual({
          ok: false,
          error: { code: "slot_unavailable", message: BOOKING_MESSAGES.unavailable },
        });
      }
    });

    it("holds customers to minimum notice but not the team", async () => {
      const soon = { now: at("09:30") }; // default notice is 2 h; 10:00 is 30 min away
      const input = {
        serviceId: a.service.id,
        staffId: a.staff.id,
        startsAt: at("10:00").toISOString(),
        customer: customer(),
      };
      const publicResult = await createBooking(page(a), input, soon);
      expect(publicResult.ok || publicResult.error.code).toBe("slot_unavailable");
      const memberResult = await createBooking({ kind: "member", actor: owner }, input, soon);
      expect(memberResult.ok).toBe(true);
      // Nobody books the past (12:00 is free, but it's 12:30 already).
      const late = await createBooking(
        { kind: "member", actor: owner },
        { ...input, startsAt: at("12:00").toISOString(), customer: customer() },
        { now: at("12:30") },
      );
      expect(late.ok || late.error.code).toBe("slot_unavailable");
    });

    it("books an offline-only service from the dashboard, not the public page", async () => {
      await db
        .update(schema.services)
        .set({ active: false })
        .where(eq(schema.services.id, a.service.id));
      try {
        const publicResult = await book(at("10:00"));
        expect(publicResult.ok || publicResult.error.code).toBe("not_found");
        const member = await book(at("10:00"), {}, { kind: "member", actor: owner });
        expect(member.ok).toBe(true);
        if (member.ok) {
          expect(await row(member.data.id)).toMatchObject({
            source: "manual",
            createdByUserId: owner.claims.sub,
          });
          expect(await events(member.data.id)).toEqual([
            expect.objectContaining({ actor: "staff", actorUserId: owner.claims.sub }),
          ]);
        }
      } finally {
        await db
          .update(schema.services)
          .set({ active: true })
          .where(eq(schema.services.id, a.service.id));
      }
    });

    it("refuses an archived service everywhere", async () => {
      await db
        .update(schema.services)
        .set({ archivedAt: new Date() })
        .where(eq(schema.services.id, a.service.id));
      try {
        expect((await book(at("10:00"))).ok).toBe(false);
        const member = await book(at("10:00"), {}, { kind: "member", actor: owner });
        expect(member.ok || member.error.code).toBe("not_found");
      } finally {
        await db
          .update(schema.services)
          .set({ archivedAt: null })
          .where(eq(schema.services.id, a.service.id));
      }
    });

    it("validates input with messages safe to show", async () => {
      const result = await book(at("10:00"), { customer: { name: " ", email: "nope" } });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_input");
      expect(result.error.fieldErrors).toBeDefined();
      expect((await book(at("10:00"), { startsAt: "tomorrow at ten" })).ok).toBe(false);
      expect((await book(at("10:00"), { serviceId: "not-a-uuid" })).ok).toBe(false);
    });

    it("lets staff book themselves but nobody else", async () => {
      const self = await book(
        at("10:00"),
        { staffId: jonahId },
        { kind: "member", actor: staffer },
      );
      expect(self.ok).toBe(true);
      const other = await book(at("10:00"), {}, { kind: "member", actor: staffer });
      expect(other).toEqual({
        ok: false,
        error: { code: "forbidden", message: BOOKING_MESSAGES.forbidden },
      });
    });
  });

  describe("double booking", () => {
    it("lets exactly one of several simultaneous bookings for one slot win", async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => book(at("11:00"))));
      const winners = results.filter((r) => r.ok);
      expect(winners).toHaveLength(1);
      for (const loser of results.filter((r) => !r.ok)) {
        expect(["slot_taken", "slot_unavailable"]).toContain(loser.ok || loser.error.code);
      }
      expect(await activeAt(at("11:00"))).toHaveLength(1);
    });

    it('maps a clash only the constraint sees to "That time was just taken"', async () => {
      // Another booking ends at 10:45 with clean-up until 11:00, not yet committed.
      const hold = await holdConflict(bookingValues(a, at("10:00")));
      const attempt = book(at("10:45"));
      await untilSomeoneWaits();
      await hold.release();
      expect(await attempt).toEqual({
        ok: false,
        error: { code: "slot_taken", message: "That time was just taken. Pick another time." },
      });
      expect(await activeAt(at("10:45"))).toHaveLength(0);
    });

    it("refuses a booking inside another's buffer, and allows one right after it", async () => {
      await booked(at("10:00")); // blocked until 11:00
      const inBuffer = await book(at("10:45"));
      expect(inBuffer.ok || inBuffer.error.code).toBe("slot_unavailable");
      expect((await book(at("11:00"))).ok).toBe(true);
    });

    it("keeps its own buffer clear of the next booking", async () => {
      await booked(at("11:00"));
      // 10:15 would end at 11:00 but clean up until 11:15.
      const result = await book(at("10:15"));
      expect(result.ok || result.error.code).toBe("slot_unavailable");
      expect((await book(at("10:00"))).ok).toBe(true); // clean-up ends exactly at 11:00
    });
  });

  describe("cancelBooking", () => {
    it("cancels, records who and why, and frees the slot for a new booking", async () => {
      const created = await booked(at("10:00"));
      const result = await cancelBooking(
        { kind: "member", actor: owner, bookingId: created.id },
        { reason: "Double-booked on paper" },
        { now: NOW },
      );
      expect(result).toEqual({
        ok: true,
        data: { id: created.id, code: created.code, notified: null },
      });
      expect(await row(created.id)).toMatchObject({
        status: "cancelled",
        cancelledAt: NOW,
        cancelledBy: "staff",
        cancelReason: "Double-booked on paper",
      });
      expect((await events(created.id)).map((e) => [e.type, e.actor, e.actorUserId])).toEqual([
        ["created", "customer", null],
        ["cancelled", "staff", owner.claims.sub],
      ]);

      const again = await book(at("10:00"));
      expect(again.ok).toBe(true);
    });

    it("won't cancel twice", async () => {
      const created = await booked(at("10:00"));
      const access = { kind: "member" as const, actor: owner, bookingId: created.id };
      expect((await cancelBooking(access, {}, { now: NOW })).ok).toBe(true);
      expect(await cancelBooking(access, {}, { now: NOW })).toEqual({
        ok: false,
        error: { code: "not_active", message: BOOKING_MESSAGES.notActive },
      });
    });

    it("lets the customer cancel with their link until the window closes", async () => {
      const early = await booked(at("10:00"));
      const ok = await cancelBooking(
        { kind: "customer", manageToken: early.manageToken },
        {},
        {
          now: NOW, // 26 h before; the window is 24 h
        },
      );
      expect(ok.ok).toBe(true);
      expect(await row(early.id)).toMatchObject({ status: "cancelled", cancelledBy: "customer" });
      expect((await events(early.id)).at(-1)).toMatchObject({
        actor: "customer",
        actorUserId: null,
      });

      const late = await booked(at("13:00"));
      const refused = await cancelBooking(
        { kind: "customer", manageToken: late.manageToken },
        {},
        {
          now: at("09:00"),
        },
      );
      expect(refused.ok || refused.error).toEqual({
        code: "too_late",
        message:
          "Online changes close 24 hours before the appointment. Contact the business to change it.",
      });
      expect((await row(late.id)).status).toBe("confirmed");
    });

    it("finds nothing for an unknown or malformed manage token", async () => {
      await booked(at("10:00"));
      for (const manageToken of ["x".repeat(43), "short", ""]) {
        const result = await cancelBooking({ kind: "customer", manageToken }, {}, { now: NOW });
        expect(result.ok || result.error.code).toBe("not_found");
      }
    });

    it("lets staff cancel their own bookings but not a colleague's", async () => {
      const mine = await booked(at("10:00"), { staffId: jonahId });
      const theirs = await booked(at("10:00"));
      const cancel = (bookingId: string) =>
        cancelBooking({ kind: "member", actor: staffer, bookingId }, {}, { now: NOW });
      expect((await cancel(mine.id)).ok).toBe(true);
      expect(await cancel(theirs.id)).toEqual({
        ok: false,
        error: { code: "forbidden", message: BOOKING_MESSAGES.forbidden },
      });
      expect((await row(theirs.id)).status).toBe("confirmed");
    });
  });

  describe("rescheduleBooking", () => {
    it("moves a booking and records where from and to", async () => {
      const created = await booked(at("10:00"));
      const result = await rescheduleBooking(
        { kind: "member", actor: owner, bookingId: created.id },
        { startsAt: at("14:00").toISOString() },
        { now: NOW },
      );
      expect(result).toEqual({
        ok: true,
        data: { id: created.id, startsAt: at("14:00"), endsAt: at("14:45"), staffId: a.staff.id },
      });
      expect(await row(created.id)).toMatchObject({
        startsAt: at("14:00"),
        bufferedEnd: at("15:00"),
        code: created.code, // same booking, same code and link
      });
      expect((await events(created.id)).at(-1)).toMatchObject({
        type: "rescheduled",
        data: {
          from: { startsAt: at("10:00").toISOString(), staffId: a.staff.id },
          to: { startsAt: at("14:00").toISOString(), staffId: a.staff.id },
        },
      });
    });

    it("can shift a booking into part of its own old time", async () => {
      const created = await booked(at("10:00"));
      const result = await rescheduleBooking(
        { kind: "customer", manageToken: created.manageToken },
        { startsAt: at("10:15").toISOString() },
        { now: NOW },
      );
      expect(result.ok).toBe(true);
    });

    it("refuses a slot another booking holds", async () => {
      await booked(at("10:00"));
      const moving = await booked(at("13:00"));
      const result = await rescheduleBooking(
        { kind: "customer", manageToken: moving.manageToken },
        { startsAt: at("10:15").toISOString() },
        { now: NOW },
      );
      expect(result.ok || result.error.code).toBe("slot_unavailable");
      expect((await row(moving.id)).startsAt).toEqual(at("13:00"));
    });

    it("maps a clash only the constraint sees to slot_taken and leaves the booking alone", async () => {
      const moving = await booked(at("13:00"));
      const hold = await holdConflict(bookingValues(a, at("10:00")));
      const attempt = rescheduleBooking(
        { kind: "member", actor: owner, bookingId: moving.id },
        { startsAt: at("10:30").toISOString() },
        { now: NOW },
      );
      await untilSomeoneWaits();
      await hold.release();
      expect(await attempt).toMatchObject({ ok: false, error: { code: "slot_taken" } });
      expect((await row(moving.id)).startsAt).toEqual(at("13:00"));
      expect((await events(moving.id)).map((e) => e.type)).toEqual(["created"]);
    });

    it("moves to another staff member when asked", async () => {
      const created = await booked(at("10:00"));
      const result = await rescheduleBooking(
        { kind: "member", actor: owner, bookingId: created.id },
        { startsAt: at("10:00").toISOString(), staffId: jonahId },
        { now: NOW },
      );
      expect(result.ok && result.data.staffId).toBe(jonahId);
    });

    it("won't let staff hand their booking to a colleague", async () => {
      const mine = await booked(at("10:00"), { staffId: jonahId });
      const result = await rescheduleBooking(
        { kind: "member", actor: staffer, bookingId: mine.id },
        { startsAt: at("11:00").toISOString(), staffId: a.staff.id },
        { now: NOW },
      );
      expect(result.ok || result.error.code).toBe("forbidden");
      expect((await row(mine.id)).staffId).toBe(jonahId);
    });

    it("refuses changes to a cancelled booking, and late changes by the customer", async () => {
      const created = await booked(at("10:00"));
      const link = { kind: "customer" as const, manageToken: created.manageToken };
      const late = await rescheduleBooking(
        link,
        { startsAt: at("14:00").toISOString() },
        {
          now: at("08:00"),
        },
      );
      expect(late.ok || late.error.code).toBe("too_late");

      await cancelBooking(link, {}, { now: NOW });
      const afterCancel = await rescheduleBooking(
        link,
        { startsAt: at("14:00").toISOString() },
        {
          now: NOW,
        },
      );
      expect(afterCancel.ok || afterCancel.error.code).toBe("not_active");
    });
  });

  describe("across businesses", () => {
    it("can't book one business's service through another's page", async () => {
      const result = await book(at("10:00"), {}, page(b));
      expect(result.ok || result.error.code).toBe("not_found");
    });

    it("can't book another business's staff member", async () => {
      const result = await book(at("10:00"), { staffId: b.staff.id });
      expect(result.ok || result.error.code).toBe("slot_unavailable");
    });

    it("an owner can't book, move or cancel another business's bookings", async () => {
      const created = await booked(at("10:00"));
      const intoA = await book(at("11:00"), {}, { kind: "member", actor: ownerB });
      expect(intoA.ok || intoA.error.code).toBe("not_found");

      const access = { kind: "member" as const, actor: ownerB, bookingId: created.id };
      const moved = await rescheduleBooking(
        access,
        { startsAt: at("14:00").toISOString() },
        {
          now: NOW,
        },
      );
      expect(moved.ok || moved.error.code).toBe("not_found");
      const cancelled = await cancelBooking(access, {}, { now: NOW });
      expect(cancelled.ok || cancelled.error.code).toBe("not_found");
      expect(await row(created.id)).toMatchObject({ status: "confirmed", startsAt: at("10:00") });
    });

    it("a forged actor (B's user claiming A's business) sees nothing to book", async () => {
      const forged: Actor = { ...ownerB, businessId: a.business.id };
      const result = await book(at("10:00"), {}, { kind: "member", actor: forged });
      expect(result.ok || result.error.code).toBe("not_found");
      const created = await booked(at("11:00"));
      const cancelled = await cancelBooking(
        { kind: "member", actor: forged, bookingId: created.id },
        {},
        { now: NOW },
      );
      expect(cancelled.ok || cancelled.error.code).toBe("not_found");
    });

    it("a manage token reaches only its own booking", async () => {
      const mine = await booked(at("10:00"));
      const other = await createBooking(
        page(b),
        {
          serviceId: b.service.id,
          staffId: b.staff.id,
          startsAt: at("10:00").toISOString(),
          customer: customer(),
        },
        { now: NOW },
      );
      expect(other.ok).toBe(true);
      await cancelBooking({ kind: "customer", manageToken: mine.manageToken }, {}, { now: NOW });
      expect(other.ok && (await row(other.data.id)).status).toBe("confirmed");
    });
  });
});

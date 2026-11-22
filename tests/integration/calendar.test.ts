import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { nextDate, todayIn, zonedInstant } from "@/lib/time-off";
import { weekdayOf } from "@/lib/today";
import { freeStaffFor, memberSlots } from "@/server/booking/service";
import { addTimeOff, type ScheduleActor } from "@/server/catalog/schedule";
import {
  getBookingDetail,
  getBookingOptions,
  getCalendar,
  searchCustomers,
} from "@/server/db/queries/calendar";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, createFixtureBusiness } from "../support/db";

const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string }[]);
vi.mock("@/server/email/send", () => ({
  sendEmail: async ({ to, subject, react }: { to: string; subject: string; react: unknown }) => {
    sent.push({ to, subject, html: renderToStaticMarkup(react as React.ReactElement) });
    return { delivered: true };
  },
}));

/*
 * The calendar's server side: reassigning bookings when time off lands on
 * them, the team's availability (memberSlots), who's free to take a booking,
 * and the reads behind the calendar, drawer and customer search.
 *
 * Business A (Manila, 30-minute grid): Mia (the owner's staff row) and Jonah
 * (a staff login) do Haircut (45 min + 15 min buffer); Aiko doesn't. All work
 * 09:00–17:00 every day. Business B is a second tenant.
 */

const MANILA = "Asia/Manila";
// A month ahead: inside the team's one-year booking window whenever this runs.
const DAY = nextDate(todayIn(MANILA, new Date()), 30);
const NEXT_WEEK = nextDate(DAY, 7);
const MONDAY_BEFORE = nextDate(DAY, -((weekdayOf(DAY) + 6) % 7));
const at = (time: string, date = DAY) => zonedInstant(date, time, MANILA);

const partDay = (startTime: string, endTime: string) => ({
  allDay: false,
  startDate: DAY,
  endDate: DAY,
  startTime,
  endTime,
  reason: "Training",
});

type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;

describe("calendar", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Fixture;
  let b: Fixture;
  let owner: ScheduleActor;
  let staffer: ScheduleActor;
  let ownerB: ScheduleActor;
  let jonahId: string;
  let aikoId: string;

  const insert = async (
    startsAt: Date,
    overrides: Partial<typeof schema.bookings.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(schema.bookings)
      .values(bookingValues(a, startsAt, overrides))
      .returning({ id: schema.bookings.id });
    return row!.id;
  };
  const booking = async (id: string) =>
    (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0]!;

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    const [ownerUser, staffUser, ownerUserB] = await Promise.all([
      users.create("cal-owner"),
      users.create("cal-staff"),
      users.create("cal-owner-b"),
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
    const [jonah, aiko] = await db
      .insert(schema.staff)
      .values([
        {
          businessId: a.business.id,
          name: "Jonah",
          color: "violet" as const,
          sortOrder: 1,
          userId: staffUser.sub,
        },
        { businessId: a.business.id, name: "Aiko", color: "pink" as const, sortOrder: 2 },
      ])
      .returning({ id: schema.staff.id });
    jonahId = jonah!.id;
    aikoId = aiko!.id;
    const everyDay = (staffId: string) =>
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        businessId: a.business.id,
        staffId,
        weekday,
        startTime: "09:00",
        endTime: "17:00",
      }));
    await db
      .insert(schema.availabilityRules)
      .values([...everyDay(a.staff.id), ...everyDay(jonahId), ...everyDay(aikoId)]);
    await db.insert(schema.staffServices).values([
      { businessId: a.business.id, staffId: a.staff.id, serviceId: a.service.id },
      { businessId: a.business.id, staffId: jonahId, serviceId: a.service.id },
    ]);
    const actor = (
      claims: typeof ownerUser,
      role: "owner" | "staff",
      businessId = a.business.id,
    ): ScheduleActor => ({
      claims,
      businessId,
      role,
      timezone: MANILA,
      slotIntervalMin: 30,
      openingHours: null,
    });
    owner = actor(ownerUser, "owner");
    staffer = actor(staffUser, "staff");
    ownerB = actor(ownerUserB, "owner", b.business.id);
  });

  beforeEach(async () => {
    sent.length = 0;
    await db.delete(schema.bookings).where(eq(schema.bookings.businessId, a.business.id));
    await db.delete(schema.timeOff).where(eq(schema.timeOff.businessId, a.business.id));
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  describe("reassign on time off", () => {
    it("offers only staff who do the service and are free at that time", async () => {
      const ten = await insert(at("10:00"));
      const two = await insert(at("14:00"));
      await insert(at("14:00"), { staffId: jonahId }); // Jonah is busy at two

      const result = await addTimeOff(owner, a.staff.id, partDay("09:00", "17:00"));
      expect(result.ok).toBe(true);
      if (!result.ok || result.data.status !== "needs_choice") throw new Error("expected a choice");
      expect(result.data.bookings.map((x) => x.id)).toEqual([ten, two]);
      // Aiko doesn't do Haircut; Jonah is free at ten only.
      expect(result.data.reassignTo).toEqual({
        [ten]: [{ id: jonahId, name: "Jonah", color: "violet" }],
        [two]: [],
      });
    });

    it("moves the chosen bookings, keeps the rest, saves the time off and emails customers", async () => {
      const ten = await insert(at("10:00"));
      const two = await insert(at("14:00"));
      const result = await addTimeOff(owner, a.staff.id, partDay("09:00", "17:00"), {
        reassign: { [ten]: jonahId },
      });
      expect(result).toMatchObject({
        ok: true,
        data: { status: "saved", reassigned: 1, notReassigned: 0, cancelled: 0 },
      });
      const moved = await booking(ten);
      expect(moved).toMatchObject({ staffId: jonahId, status: "confirmed" });
      expect(moved.startsAt).toEqual(at("10:00")); // same time, new person
      expect((await booking(two)).staffId).toBe(a.staff.id); // left out: kept
      const events = await db
        .select({ type: schema.bookingEvents.type, data: schema.bookingEvents.data })
        .from(schema.bookingEvents)
        .where(eq(schema.bookingEvents.bookingId, ten));
      expect(events).toEqual([
        {
          type: "rescheduled",
          data: {
            from: { startsAt: at("10:00").toISOString(), staffId: a.staff.id },
            to: { startsAt: at("10:00").toISOString(), staffId: jonahId },
          },
        },
      ]);
      const timeOff = await db
        .select()
        .from(schema.timeOff)
        .where(eq(schema.timeOff.staffId, a.staff.id));
      expect(timeOff).toHaveLength(1);
      await expect.poll(() => sent.length).toBe(1);
      expect(sent[0]!.html).toContain("Jonah");
    });

    it("counts a booking it couldn't move (taken meanwhile) and leaves it where it was", async () => {
      const ten = await insert(at("10:00"));
      await insert(at("10:00"), { staffId: jonahId }); // Jonah got booked first
      const result = await addTimeOff(owner, a.staff.id, partDay("09:00", "12:00"), {
        reassign: { [ten]: jonahId },
      });
      expect(result).toMatchObject({
        ok: true,
        data: { status: "saved", reassigned: 0, notReassigned: 1 },
      });
      expect((await booking(ten)).staffId).toBe(a.staff.id);
    });

    it("refuses to hand a booking to someone who doesn't do the service", async () => {
      const ten = await insert(at("10:00"));
      const result = await addTimeOff(owner, a.staff.id, partDay("09:00", "12:00"), {
        reassign: { [ten]: aikoId },
      });
      expect(result).toMatchObject({ ok: true, data: { reassigned: 0, notReassigned: 1 } });
      expect((await booking(ten)).staffId).toBe(a.staff.id);
    });

    it("never offers or allows reassigning to staff (RLS: their own bookings only)", async () => {
      const mine = await insert(at("10:00"), { staffId: jonahId });
      const asked = await addTimeOff(staffer, jonahId, partDay("09:00", "12:00"));
      expect(asked).toMatchObject({ ok: true, data: { status: "needs_choice", reassignTo: null } });
      const result = await addTimeOff(staffer, jonahId, partDay("09:00", "12:00"), {
        reassign: { [mine]: a.staff.id },
      });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect((await booking(mine)).staffId).toBe(jonahId);
    });
  });

  describe("memberSlots", () => {
    const now = at("09:40");

    it("offers the team every free time today, without minimum notice", async () => {
      await insert(at("11:00"));
      const result = await memberSlots(
        owner,
        MANILA,
        { serviceId: a.service.id, staffId: a.staff.id, date: DAY },
        { now },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const times = result.data.slots.map((s) => s.time);
      // Past times are gone; 10:00 is 20 minutes away (the public page would need 2 h).
      expect(times[0]).toBe("10:00");
      // 10:30 would run into 11:00; 11:00 is taken and its buffer runs to 12:00.
      expect(times).not.toContain("10:30");
      expect(times).not.toContain("11:00");
      expect(times).not.toContain("11:30");
      expect(times).toContain("12:00");
      expect(times.at(-1)).toBe("16:00"); // the last 45 minutes that fit before 17:00
    });

    it("frees a booking's own time when moving it", async () => {
      const id = await insert(at("11:00"));
      const result = await memberSlots(
        owner,
        MANILA,
        { serviceId: a.service.id, staffId: a.staff.id, date: DAY, excludeBookingId: id },
        { now },
      );
      expect(result.ok && result.data.slots.map((s) => s.time)).toContain("11:00");
    });

    it("rejects bad input and other businesses' services", async () => {
      const bad = await memberSlots(owner, MANILA, { serviceId: "x", staffId: "any", date: DAY });
      expect(bad).toMatchObject({ ok: false, error: { code: "invalid_input" } });
      const other = await memberSlots(owner, MANILA, {
        serviceId: b.service.id,
        staffId: "any",
        date: DAY,
      });
      expect(other).toMatchObject({ ok: false, error: { code: "not_found" } });
    });
  });

  it("freeStaffFor sees only this business's bookings", async () => {
    const ten = await insert(at("10:00"));
    expect(await freeStaffFor(owner, [ten])).toEqual({
      [ten]: [{ id: jonahId, name: "Jonah", color: "violet" }],
    });
    expect(await freeStaffFor(ownerB, [ten])).toEqual({});
    expect(await freeStaffFor({ ...ownerB, businessId: a.business.id }, [ten])).toEqual({});
  });

  describe("reads", () => {
    it("loads the week: staff with hours and time off, and every booking in range", async () => {
      await insert(at("10:00"));
      await insert(at("10:00"), { staffId: jonahId, status: "cancelled" });
      await insert(at("10:00", NEXT_WEEK)); // next week
      await db.insert(schema.timeOff).values({
        businessId: a.business.id,
        staffId: aikoId,
        startsAt: at("13:00"),
        endsAt: at("17:00"),
      });
      const data = await getCalendar(owner.claims, a.business.id, {
        from: at("00:00", MONDAY_BEFORE),
        to: at("00:00", nextDate(MONDAY_BEFORE, 7)),
      });
      expect(data.staff.map((s) => [s.name, s.isMe])).toEqual([
        ["Mia", true],
        ["Jonah", false],
        ["Aiko", false],
      ]);
      expect(data.staff[0]!.hours).toHaveLength(7);
      expect(data.staff[2]!.timeOff).toEqual([{ startsAt: at("13:00"), endsAt: at("17:00") }]);
      expect(data.bookings.map((x) => x.status).sort()).toEqual(["cancelled", "confirmed"]);

      const other = await getCalendar(ownerB.claims, a.business.id, {
        from: at("00:00", MONDAY_BEFORE),
        to: at("00:00", nextDate(MONDAY_BEFORE, 7)),
      });
      expect(other).toEqual({ staff: [], bookings: [] });
    });

    it("loads a booking's detail with its history, for members of its business only", async () => {
      const id = await insert(at("10:00"), { source: "ai", customerNotes: "Fringe only" });
      await addTimeOff(owner, a.staff.id, partDay("09:00", "12:00"), {
        reassign: { [id]: jonahId },
      });
      const detail = await getBookingDetail(owner.claims, a.business.id, id);
      expect(detail).toMatchObject({
        id,
        source: "ai",
        staffName: "Jonah",
        staffColor: "violet",
        isMine: false,
        serviceName: "Haircut",
        customerName: "Ana Santos",
        customerEmail: a.customer.email,
        notes: "Fringe only",
        cancellationWindowHours: 24,
      });
      expect(detail!.events.map((e) => e.type)).toEqual(["rescheduled"]);
      expect((await getBookingDetail(staffer.claims, a.business.id, id))?.isMine).toBe(true);
      expect(await getBookingDetail(ownerB.claims, a.business.id, id)).toBeNull();
      expect(await getBookingDetail(ownerB.claims, b.business.id, id)).toBeNull();
    });

    it("lists what the sheet can book: unarchived services and active staff with theirs", async () => {
      const options = await getBookingOptions(owner.claims, a.business.id);
      expect(options.services.map((s) => s.name)).toEqual(["Haircut"]);
      expect(options.staff.map((s) => [s.name, s.serviceIds.length])).toEqual([
        ["Mia", 1],
        ["Jonah", 1],
        ["Aiko", 0],
      ]);
    });

    it("searches customers by name or email, safely, within the business", async () => {
      expect(
        (await searchCustomers(owner.claims, a.business.id, "ana s")).map((c) => c.name),
      ).toEqual(["Ana Santos"]);
      expect(
        await searchCustomers(owner.claims, a.business.id, a.customer.email.slice(0, 8)),
      ).toHaveLength(1);
      expect(await searchCustomers(owner.claims, a.business.id, "%")).toEqual([]); // too short
      expect(await searchCustomers(owner.claims, a.business.id, "%_")).toEqual([]); // wildcards are literal
      expect(await searchCustomers(ownerB.claims, a.business.id, "Ana")).toEqual([]);
    });
  });
});

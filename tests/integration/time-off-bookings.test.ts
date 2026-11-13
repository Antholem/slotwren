import { renderToStaticMarkup } from "react-dom/server";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { zonedInstant } from "@/lib/time-off";
import { addTimeOff, editTimeOff, type ScheduleActor } from "@/server/catalog/schedule";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, createFixtureBusiness } from "../support/db";

// Capture emails instead of sending (or logging) them.
const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string }[]);
vi.mock("@/server/email/send", () => ({
  sendEmail: async ({ to, subject, react }: { to: string; subject: string; react: unknown }) => {
    sent.push({ to, subject, html: renderToStaticMarkup(react as React.ReactElement) });
    return { delivered: true };
  },
}));

/*
 * Time off that overlaps bookings: the owner is shown them and chooses to
 * keep them or cancel them and email the customers. Cancelling goes through
 * booking/service.ts, so it gets the audit trail and RLS like any other.
 */

const MANILA = "Asia/Manila";
const DAY = "2026-12-01";
const at = (time: string) => zonedInstant(DAY, time, MANILA);

const partDay = (startTime: string, endTime: string, reason = "Dentist") => ({
  allDay: false,
  startDate: DAY,
  endDate: DAY,
  startTime,
  endTime,
  reason,
});

describe("time off over existing bookings", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let owner: ScheduleActor;
  let staffer: ScheduleActor;
  let jonahId: string;

  const insert = async (
    startsAt: Date,
    overrides: Partial<typeof schema.bookings.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(schema.bookings)
      .values(bookingValues(a, startsAt, overrides))
      .returning({ id: schema.bookings.id, code: schema.bookings.code });
    return row!;
  };
  const statusOf = async (id: string) =>
    (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0]!;
  const timeOffCount = async (staffId: string) =>
    (await db.select().from(schema.timeOff).where(eq(schema.timeOff.staffId, staffId))).length;

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    const [ownerUser, staffUser] = await Promise.all([
      users.create("off-owner"),
      users.create("off-staff"),
    ]);
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerUser.sub, role: "owner" },
      { businessId: a.business.id, userId: staffUser.sub, role: "staff" },
    ]);
    const [jonah] = await db
      .insert(schema.staff)
      .values({ businessId: a.business.id, name: "Jonah", color: "violet", userId: staffUser.sub })
      .returning({ id: schema.staff.id });
    jonahId = jonah!.id;
    const actor = (claims: typeof ownerUser, role: "owner" | "staff"): ScheduleActor => ({
      claims,
      businessId: a.business.id,
      role,
      timezone: MANILA,
      slotIntervalMin: 30,
      openingHours: null,
    });
    owner = actor(ownerUser, "owner");
    staffer = actor(staffUser, "staff");
  });

  beforeEach(async () => {
    sent.length = 0;
    await db.delete(schema.bookings).where(eq(schema.bookings.businessId, a.business.id));
    await db.delete(schema.timeOff).where(eq(schema.timeOff.businessId, a.business.id));
  });

  afterAll(async () => {
    await a?.cleanup();
    await users.cleanup();
    await close();
  });

  it("shows the overlapping bookings and saves nothing until the owner chooses", async () => {
    const tenOClock = await insert(at("10:00"));
    const eleven = await insert(at("11:00"));
    await insert(at("10:00"), { status: "cancelled" }); // not active
    await insert(at("10:00"), { staffId: jonahId }); // someone else
    await insert(at("08:00")); // ends 08:45; its clean-up runs to 09:00 only
    await insert(at("12:00")); // starts as the time off ends

    const result = await addTimeOff(owner, a.staff.id, partDay("09:00", "12:00"));
    expect(result).toEqual({
      ok: true,
      data: {
        status: "needs_choice",
        bookings: [
          {
            id: tenOClock.id,
            code: tenOClock.code,
            startsAt: at("10:00"),
            endsAt: at("10:45"),
            serviceName: "Haircut",
            customerName: "Ana Santos",
          },
          expect.objectContaining({ id: eleven.id, startsAt: at("11:00") }),
        ],
      },
    });
    expect(await timeOffCount(a.staff.id)).toBe(0);
    expect(sent).toEqual([]);
  });

  it("saves straight away when nothing overlaps", async () => {
    await insert(at("14:00"));
    const result = await addTimeOff(owner, a.staff.id, partDay("09:00", "12:00"));
    expect(result).toMatchObject({
      ok: true,
      data: { status: "saved", cancelled: 0, notified: 0, notCancelled: 0 },
    });
    expect(await timeOffCount(a.staff.id)).toBe(1);
  });

  it("keeps the bookings when asked", async () => {
    const booking = await insert(at("10:00"));
    const result = await addTimeOff(owner, a.staff.id, partDay("09:00", "12:00"), "keep");
    expect(result).toMatchObject({ ok: true, data: { status: "saved", cancelled: 0 } });
    expect(await timeOffCount(a.staff.id)).toBe(1);
    expect((await statusOf(booking.id)).status).toBe("confirmed");
    expect(sent).toEqual([]);
  });

  it("cancels them and emails each customer, without the team-only reason", async () => {
    const first = await insert(at("10:00"));
    const second = await insert(at("11:00"));
    const result = await addTimeOff(owner, a.staff.id, partDay("09:00", "12:00"), "cancel");
    expect(result).toMatchObject({
      ok: true,
      data: { status: "saved", cancelled: 2, notified: 2, notCancelled: 0 },
    });
    expect(await timeOffCount(a.staff.id)).toBe(1);

    for (const booking of [first, second]) {
      expect(await statusOf(booking.id)).toMatchObject({
        status: "cancelled",
        cancelledBy: "staff",
        cancelReason: "Time off: Dentist", // for the team
      });
      const events = await db
        .select()
        .from(schema.bookingEvents)
        .where(
          and(
            eq(schema.bookingEvents.bookingId, booking.id),
            inArray(schema.bookingEvents.type, ["cancelled"]),
          ),
        );
      expect(events).toEqual([
        expect.objectContaining({ actor: "staff", actorUserId: owner.claims.sub }),
      ]);
    }

    expect(sent.map((email) => [email.to, email.subject])).toEqual([
      [a.customer.email, `Cancelled: Haircut at ${a.business.name}`],
      [a.customer.email, `Cancelled: Haircut at ${a.business.name}`],
    ]);
    const html = sent[0]!.html;
    expect(html).toContain(first.code);
    expect(html).toContain("Tue 1 Dec · 10:00 GMT+8");
    expect(html).toContain("Mia isn&#x27;t available at that time any more.");
    expect(html).toContain(`/b/${a.business.slug}`);
    expect(html).not.toContain("Dentist");
  });

  it("asks again when an edit stretches time off over a booking", async () => {
    const created = await addTimeOff(owner, a.staff.id, partDay("09:00", "10:00"));
    const id = created.ok && created.data.status === "saved" ? created.data.id : "";
    const booking = await insert(at("10:00"));

    const stretched = await editTimeOff(owner, id, partDay("09:00", "12:00"));
    expect(stretched).toMatchObject({ ok: true, data: { status: "needs_choice" } });
    const [unchanged] = await db.select().from(schema.timeOff).where(eq(schema.timeOff.id, id));
    expect(unchanged!.endsAt).toEqual(at("10:00"));

    const confirmed = await editTimeOff(owner, id, partDay("09:00", "12:00"), "cancel");
    expect(confirmed).toMatchObject({ ok: true, data: { status: "saved", id, cancelled: 1 } });
    expect((await statusOf(booking.id)).status).toBe("cancelled");
  });

  it("lets staff clear their own bookings for their own time off", async () => {
    const mine = await insert(at("10:00"), { staffId: jonahId });
    const result = await addTimeOff(staffer, jonahId, partDay("09:00", "12:00"), "cancel");
    expect(result).toMatchObject({ ok: true, data: { status: "saved", cancelled: 1 } });
    expect((await statusOf(mine.id)).status).toBe("cancelled");
  });

  it("refuses an unknown choice", async () => {
    await insert(at("10:00"));
    const result = await addTimeOff(owner, a.staff.id, partDay("09:00", "12:00"), "reassign");
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await timeOffCount(a.staff.id)).toBe(0);
  });
});

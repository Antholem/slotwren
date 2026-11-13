import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type DayHours, WEEK_ORDER } from "@/lib/hours";
import {
  addTimeOff,
  editTimeOff,
  removeTimeOff,
  saveStaffHours,
  type ScheduleActor,
} from "@/server/catalog/schedule";
import type { RlsClaims } from "@/server/db/client";
import { createTimeOff, deleteTimeOff, updateTimeOff } from "@/server/db/queries/schedule";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { connectTestDb, createFixtureBusiness, pgErrorCode } from "../support/db";

/*
 * Weekly hours and time off as real signed-in users: owners edit anyone's
 * schedule, staff only their own (catalog check and RLS both), other
 * businesses see nothing. Business A is in America/New_York so the stored
 * instants can be checked across the November 2026 DST change.
 */

const ZONE = "America/New_York";

/** A week from "weekday: [start, end]" pairs; days not listed are off. */
function week(open: Record<number, [string, string][]>): DayHours[] {
  return WEEK_ORDER.map((weekday) => ({
    weekday,
    open: weekday in open,
    ranges: (open[weekday] ?? []).map(([start, end]) => ({ start, end })),
  }));
}

const allDay = (startDate: string, endDate = startDate, reason = "") => ({
  allDay: true,
  startDate,
  endDate,
  startTime: "09:00",
  endTime: "17:00",
  reason,
});

const partDay = (date: string, startTime: string, endTime: string) => ({
  allDay: false,
  startDate: date,
  endDate: date,
  startTime,
  endTime,
  reason: "Dentist",
});

describe("staff schedules", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let b: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let owner: ScheduleActor;
  let staffer: ScheduleActor;
  let otherOwner: ScheduleActor;
  let staffClaims: RlsClaims;
  let samId: string; // the staff user's own row
  let jonahId: string; // no login

  const rulesOf = (staffId: string) =>
    db
      .select({
        weekday: schema.availabilityRules.weekday,
        startTime: schema.availabilityRules.startTime,
        endTime: schema.availabilityRules.endTime,
      })
      .from(schema.availabilityRules)
      .where(eq(schema.availabilityRules.staffId, staffId))
      .orderBy(schema.availabilityRules.weekday, schema.availabilityRules.startTime);
  const timeOffRow = async (id: string) =>
    (await db.select().from(schema.timeOff).where(eq(schema.timeOff.id, id)))[0];

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    await db
      .update(schema.businesses)
      .set({ timezone: ZONE })
      .where(eq(schema.businesses.id, a.business.id));

    const [ownerUser, staffUser, ownerUserB] = await Promise.all([
      users.create("sched-owner-a"),
      users.create("sched-staff-a"),
      users.create("sched-owner-b"),
    ]);
    staffClaims = staffUser;
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerUser.sub, role: "owner" },
      { businessId: a.business.id, userId: staffUser.sub, role: "staff" },
      { businessId: b.business.id, userId: ownerUserB.sub, role: "owner" },
    ]);
    await db
      .update(schema.staff)
      .set({ userId: ownerUser.sub })
      .where(eq(schema.staff.id, a.staff.id));
    const [sam, jonah] = await db
      .insert(schema.staff)
      .values([
        { businessId: a.business.id, name: "Sam", color: "violet", userId: staffUser.sub },
        { businessId: a.business.id, name: "Jonah", color: "pink" },
      ])
      .returning({ id: schema.staff.id });
    samId = sam!.id;
    jonahId = jonah!.id;

    const openingHours = [2, 3, 4, 5, 6, 0].map((weekday) => ({
      weekday,
      start: "09:00",
      end: "18:00",
    }));
    const actor = (claims: RlsClaims, businessId: string, role: "owner" | "staff") => ({
      claims,
      businessId,
      role,
      timezone: ZONE,
      slotIntervalMin: 30,
      openingHours,
    });
    owner = actor(ownerUser, a.business.id, "owner");
    staffer = actor(staffUser, a.business.id, "staff");
    otherOwner = actor(ownerUserB, b.business.id, "owner");
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  describe("weekly hours", () => {
    it("an owner replaces anyone's hours, with several ranges a day", async () => {
      const result = await saveStaffHours(owner, jonahId, {
        days: week({
          2: [
            ["09:00", "12:00"],
            ["13:00", "18:00"],
          ],
          3: [["09:00", "18:00"]],
        }),
      });
      expect(result).toEqual({ ok: true, data: { warnings: [] } });
      expect(await rulesOf(jonahId)).toEqual([
        { weekday: 2, startTime: "09:00:00", endTime: "12:00:00" },
        { weekday: 2, startTime: "13:00:00", endTime: "18:00:00" },
        { weekday: 3, startTime: "09:00:00", endTime: "18:00:00" },
      ]);

      // Saving again replaces, not appends; a week off is allowed.
      expect((await saveStaffHours(owner, jonahId, { days: week({}) })).ok).toBe(true);
      expect(await rulesOf(jonahId)).toEqual([]);
    });

    it("warns, but saves, when hours fall outside opening hours", async () => {
      const result = await saveStaffHours(owner, jonahId, {
        days: week({ 1: [["10:00", "16:00"]], 2: [["08:00", "17:00"]] }),
      });
      expect(result).toEqual({
        ok: true,
        data: {
          warnings: [
            "Monday: the business is closed that day.",
            "Tuesday: outside opening hours (09:00 – 18:00).",
          ],
        },
      });
      expect(await rulesOf(jonahId)).toHaveLength(2);
    });

    it("a staff member edits their own hours", async () => {
      const result = await saveStaffHours(staffer, samId, {
        days: week({ 4: [["10:00", "15:30"]] }),
      });
      expect(result.ok).toBe(true);
      expect(await rulesOf(samId)).toEqual([
        { weekday: 4, startTime: "10:00:00", endTime: "15:30:00" },
      ]);
    });

    it("a staff member can't edit someone else's hours", async () => {
      const before = await rulesOf(jonahId);
      const result = await saveStaffHours(staffer, jonahId, { days: week({}) });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(await rulesOf(jonahId)).toEqual(before);
      expect((await saveStaffHours(staffer, a.staff.id, { days: week({}) })).ok).toBe(false);
    });

    it("another business can't see or edit them", async () => {
      const before = await rulesOf(jonahId);
      const result = await saveStaffHours(otherOwner, jonahId, { days: week({}) });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
      expect(await rulesOf(jonahId)).toEqual(before);
    });

    it.each([
      ["off the grid", week({ 2: [["09:15", "17:00"]] }), "hour or half hour"],
      ["end before start", week({ 2: [["17:00", "09:00"]] }), "End after it starts"],
      [
        "overlapping ranges",
        week({
          2: [
            ["09:00", "13:00"],
            ["12:00", "18:00"],
          ],
        }),
        "overlap",
      ],
    ])("rejects %s", async (_case, days, message) => {
      const result = await saveStaffHours(owner, jonahId, { days });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
      expect(result.ok ? "" : result.error.message).toContain(message);
    });

    it("follows a 15-minute slot interval", async () => {
      const quarter = { ...owner, slotIntervalMin: 15 };
      const result = await saveStaffHours(quarter, jonahId, {
        days: week({ 2: [["09:15", "17:45"]] }),
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("time off", () => {
    let samOff: string;
    let jonahOff: string;

    it("a staff member adds their own, stored from the business timezone across DST", async () => {
      // Sunday 1 Nov 2026: New York falls back, so the day is 25 hours long.
      const result = await addTimeOff(
        staffer,
        samId,
        allDay("2026-11-01", "2026-11-01", "Wedding"),
      );
      expect(result.ok).toBe(true);
      samOff = result.ok && result.data.status === "saved" ? result.data.id : "";
      expect(await timeOffRow(samOff)).toMatchObject({
        staffId: samId,
        businessId: a.business.id,
        allDay: true,
        reason: "Wedding",
        startsAt: new Date("2026-11-01T04:00:00Z"), // midnight EDT
        endsAt: new Date("2026-11-02T05:00:00Z"), // midnight EST
      });
    });

    it("part of a day converts each end on its own side of the change", async () => {
      const result = await addTimeOff(staffer, samId, partDay("2026-11-02", "13:00", "17:00"));
      expect(result.ok).toBe(true);
      const row = await timeOffRow(
        result.ok && result.data.status === "saved" ? result.data.id : "",
      );
      expect(row).toMatchObject({
        allDay: false,
        startsAt: new Date("2026-11-02T18:00:00Z"), // 13:00 EST
        endsAt: new Date("2026-11-02T22:00:00Z"),
      });
    });

    it("refuses a time the clocks skip", async () => {
      const result = await addTimeOff(staffer, samId, partDay("2026-03-08", "02:30", "04:00"));
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    });

    it("a staff member can't add, edit or delete someone else's", async () => {
      expect(await addTimeOff(staffer, jonahId, allDay("2026-12-24"))).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });

      const created = await addTimeOff(owner, jonahId, allDay("2026-12-24", "2026-12-26"));
      expect(created.ok).toBe(true);
      jonahOff = created.ok && created.data.status === "saved" ? created.data.id : "";
      const before = await timeOffRow(jonahOff);

      expect(await editTimeOff(staffer, jonahOff, allDay("2027-01-04"))).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
      expect(await removeTimeOff(staffer, jonahOff)).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
      expect(await timeOffRow(jonahOff)).toEqual(before);
    });

    it("RLS refuses it too, below the server functions", async () => {
      const values = {
        allDay: true,
        startsAt: new Date("2027-01-04T05:00:00Z"),
        endsAt: new Date("2027-01-05T05:00:00Z"),
        reason: null,
      };
      const insert = createTimeOff(staffClaims, a.business.id, jonahId, values);
      await expect(insert).rejects.toSatisfy((e) => pgErrorCode(e) === "42501");
      expect(await updateTimeOff(staffClaims, a.business.id, jonahOff, values)).toBe(false);
      expect(await deleteTimeOff(staffClaims, a.business.id, jonahOff)).toBe(false);
      expect(await timeOffRow(jonahOff)).toBeDefined();
    });

    it("a staff member edits and deletes their own", async () => {
      const edited = await editTimeOff(staffer, samOff, allDay("2026-11-01", "2026-11-03"));
      expect(edited.ok).toBe(true);
      expect((await timeOffRow(samOff))?.endsAt).toEqual(new Date("2026-11-04T05:00:00Z"));

      expect((await removeTimeOff(staffer, samOff)).ok).toBe(true);
      expect(await timeOffRow(samOff)).toBeUndefined();
    });

    it("an owner edits and deletes anyone's", async () => {
      const [entry] = await db
        .insert(schema.timeOff)
        .values({
          businessId: a.business.id,
          staffId: samId,
          startsAt: new Date("2026-12-01T05:00:00Z"),
          endsAt: new Date("2026-12-02T05:00:00Z"),
          allDay: true,
        })
        .returning({ id: schema.timeOff.id });

      const edited = await editTimeOff(owner, entry!.id, partDay("2026-12-01", "09:00", "12:00"));
      expect(edited.ok).toBe(true);
      expect(await timeOffRow(entry!.id)).toMatchObject({
        allDay: false,
        startsAt: new Date("2026-12-01T14:00:00Z"),
        endsAt: new Date("2026-12-01T17:00:00Z"),
      });
      expect((await removeTimeOff(owner, entry!.id)).ok).toBe(true);
      expect((await removeTimeOff(owner, jonahOff)).ok).toBe(true);
    });

    it("another business can't touch it", async () => {
      const created = await addTimeOff(owner, jonahId, allDay("2027-02-01"));
      const id = created.ok && created.data.status === "saved" ? created.data.id : "";
      expect(await addTimeOff(otherOwner, jonahId, allDay("2027-02-02"))).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
      expect(await editTimeOff(otherOwner, id, allDay("2027-02-03"))).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
      expect(await removeTimeOff(otherOwner, id)).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
      // Even straight through the query layer, with A's business id.
      expect(await deleteTimeOff(otherOwner.claims, a.business.id, id)).toBe(false);
      const left = await db
        .select()
        .from(schema.timeOff)
        .where(and(eq(schema.timeOff.id, id), eq(schema.timeOff.businessId, a.business.id)));
      expect(left).toHaveLength(1);
    });

    it.each([
      ["a last day before the first", allDay("2026-12-10", "2026-12-09")],
      ["an end before the start", partDay("2026-12-10", "15:00", "11:00")],
      ["a time off the grid", partDay("2026-12-10", "09:10", "11:00")],
      ["a made-up date", allDay("2026-02-30")],
    ])("rejects %s", async (_case, input) => {
      expect(await addTimeOff(owner, jonahId, input)).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
    });
  });
});

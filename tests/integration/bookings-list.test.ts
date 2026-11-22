import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type BookingFilters, parseBookingFilters } from "@/lib/bookings-filter";
import { nextDate, zonedInstant } from "@/lib/time-off";
import { recordOutcomes } from "@/server/booking/service";
import type { Actor } from "@/server/catalog/services";
import { bookingBatches, listBookings } from "@/server/db/queries/bookings-list";
import * as schema from "@/server/db/schema";
import { bookingsCsv } from "@/server/export/bookings-csv";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, countQueries, createFixtureBusiness } from "../support/db";

/*
 * The Bookings table: server-side filters (status, staff, service, source,
 * date range in the business timezone), search, sorting, pagination, the CSV
 * export (content, timezone, formula injection), bulk outcomes, permissions
 * and the query count (no N+1).
 *
 * Business A is in Manila (UTC+8). NOW is Wed 2 Dec 2026, 10:00 there.
 */

const MANILA = "Asia/Manila";
const TODAY = "2026-12-02";
const at = (date: string, time: string) => zonedInstant(date, time, MANILA);
const NOW = at(TODAY, "10:00");

type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;

describe("bookings list", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Fixture;
  let b: Fixture;
  let owner: Actor;
  let staffer: Actor;
  let ownerB: Actor;
  let jonahId: string;
  let colourId: string;
  let benId: string;

  const filters = (params: Record<string, string> = {}): BookingFilters =>
    parseBookingFilters(params);
  const list = (
    actor: Actor,
    params: Record<string, string> = {},
    page = { limit: 25, offset: 0 },
  ) =>
    listBookings(actor.claims, actor.businessId, filters(params), {
      zone: MANILA,
      now: NOW,
      today: TODAY,
      ...page,
    });
  const codes = async (actor: Actor, params: Record<string, string> = {}) =>
    (await list(actor, params)).rows.map((r) => r.code);

  const insert = async (
    code: string,
    startsAt: Date,
    overrides: Partial<typeof schema.bookings.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(schema.bookings)
      .values(bookingValues(a, startsAt, { code, ...overrides }))
      .returning({ id: schema.bookings.id });
    return row!.id;
  };

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    await db
      .update(schema.businesses)
      .set({ timezone: MANILA })
      .where(eq(schema.businesses.id, a.business.id));
    const [ownerUser, staffUser, ownerUserB] = await Promise.all([
      users.create("list-owner"),
      users.create("list-staff"),
      users.create("list-owner-b"),
    ]);
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerUser.sub, role: "owner" },
      { businessId: a.business.id, userId: staffUser.sub, role: "staff" },
      { businessId: b.business.id, userId: ownerUserB.sub, role: "owner" },
    ]);
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
    const [colour] = await db
      .insert(schema.services)
      .values({ businessId: a.business.id, name: "Colour", durationMin: 90, priceCents: 8000 })
      .returning({ id: schema.services.id });
    colourId = colour!.id;
    const [ben] = await db
      .insert(schema.customers)
      .values({
        businessId: a.business.id,
        name: "Ben Ortiz",
        email: "ben@example.org",
        phone: "+639171234567",
      })
      .returning({ id: schema.customers.id });
    benId = ben!.id;
    owner = { claims: ownerUser, businessId: a.business.id, role: "owner" };
    staffer = { claims: staffUser, businessId: a.business.id, role: "staff" };
    ownerB = { claims: ownerUserB, businessId: b.business.id, role: "owner" };
  });

  beforeEach(async () => {
    await db.delete(schema.bookings).where(eq(schema.bookings.businessId, a.business.id));
    await db.delete(schema.bookings).where(eq(schema.bookings.businessId, b.business.id));
    // Today and the next days (Manila), a past week, and next month.
    await insert("SW-AAAA-01", at(TODAY, "09:00"), { status: "completed" });
    await insert("SW-AAAA-02", at(TODAY, "14:00"), { staffId: jonahId, source: "ai" });
    await insert("SW-AAAA-03", at(nextDate(TODAY), "10:00"), {
      customerId: benId,
      customerName: "Ben Ortiz",
      serviceId: colourId,
      priceCents: 8000,
      source: "widget",
    });
    await insert("SW-AAAA-04", at(nextDate(TODAY, 3), "11:00"), { status: "cancelled" });
    // The 7th day ends at local midnight: 23:00 on day 6 is in, 00:30 on day 7 is out.
    await insert("SW-AAAA-05", at(nextDate(TODAY, 6), "23:00"), { source: "manual" });
    await insert("SW-AAAA-06", at(nextDate(TODAY, 7), "00:30"), { status: "pending" });
    await insert("SW-AAAA-07", at(nextDate(TODAY, -3), "10:00"), { status: "no_show" });
    await insert("SW-AAAA-08", at(nextDate(TODAY, 30), "10:00"));
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  describe("filters", () => {
    it("defaults to the next 7 days, ending at local midnight, soonest first", async () => {
      expect(await codes(owner)).toEqual([
        "SW-AAAA-01",
        "SW-AAAA-02",
        "SW-AAAA-03",
        "SW-AAAA-04",
        "SW-AAAA-05",
      ]);
    });

    it("reads every date range in the business timezone", async () => {
      expect(await codes(owner, { range: "today" })).toEqual(["SW-AAAA-01", "SW-AAAA-02"]);
      expect(await codes(owner, { range: "past7" })).toEqual(["SW-AAAA-07", "SW-AAAA-01"]);
      expect(await codes(owner, { range: "upcoming" })).toEqual([
        "SW-AAAA-02",
        "SW-AAAA-03",
        "SW-AAAA-04",
        "SW-AAAA-05",
        "SW-AAAA-06",
        "SW-AAAA-08",
      ]);
      expect(await codes(owner, { range: "all" })).toHaveLength(8);
      // Custom: both ends inclusive, and backwards still works.
      expect(
        await codes(owner, { range: "custom", from: nextDate(TODAY, 7), to: nextDate(TODAY, 6) }),
      ).toEqual(["SW-AAAA-05", "SW-AAAA-06"]);
    });

    it("filters by status, staff, service and source, together", async () => {
      const all = { range: "all" };
      expect(await codes(owner, { ...all, status: "cancelled" })).toEqual(["SW-AAAA-04"]);
      expect(await codes(owner, { ...all, staff: jonahId })).toEqual(["SW-AAAA-02"]);
      expect(await codes(owner, { ...all, service: colourId })).toEqual(["SW-AAAA-03"]);
      expect(await codes(owner, { ...all, source: "ai" })).toEqual(["SW-AAAA-02"]);
      expect(await codes(owner, { ...all, source: "page", status: "pending" })).toEqual([
        "SW-AAAA-06",
      ]);
    });

    it("searches customer name, email and code, case-insensitively and literally", async () => {
      const all = { range: "all" };
      expect(await codes(owner, { ...all, q: "ben ort" })).toEqual(["SW-AAAA-03"]);
      expect(await codes(owner, { ...all, q: "EXAMPLE.ORG" })).toEqual(["SW-AAAA-03"]);
      expect(await codes(owner, { ...all, q: "sw-aaaa-07" })).toEqual(["SW-AAAA-07"]);
      expect(await codes(owner, { ...all, q: "%" })).toEqual([]);
      expect(await codes(owner, { ...all, q: "_" })).toEqual([]);
    });

    it("sorts and paginates, with the total of all matches", async () => {
      const byPrice = await codes(owner, { range: "all", sort: "price", dir: "desc" });
      expect(byPrice[0]).toBe("SW-AAAA-03");
      const page2 = await list(owner, { range: "all" }, { limit: 3, offset: 3 });
      expect(page2.total).toBe(8);
      expect(page2.rows.map((r) => r.code)).toEqual(["SW-AAAA-03", "SW-AAAA-04", "SW-AAAA-05"]);
    });

    it("still knows the total on a page past the end (no row to carry it)", async () => {
      const past = await list(owner, { range: "all" }, { limit: 5, offset: 10 });
      expect(past).toEqual({ rows: [], total: 8 });
      const none = await list(owner, { range: "all", q: "nobody" }, { limit: 5, offset: 10 });
      expect(none).toEqual({ rows: [], total: 0 });
    });

    it("ignores malformed filters instead of failing", async () => {
      const parsed = parseBookingFilters({
        status: "paid",
        staff: "nope",
        range: "forever",
        page: "-2",
        sort: "drop table",
      });
      expect(parsed).toMatchObject({
        status: null,
        staff: null,
        range: "next7",
        page: 1,
        sort: "date",
      });
    });
  });

  describe("permissions", () => {
    it("shows staff the whole team's bookings (the team calendar), and other businesses nothing", async () => {
      expect(await codes(staffer, { range: "all" })).toHaveLength(8);
      expect(await codes(ownerB, { range: "all" })).toEqual([]);
      expect(await codes({ ...ownerB, businessId: a.business.id }, { range: "all" })).toEqual([]);
    });

    it("bulk outcomes: started ones are marked, later or others' are skipped", async () => {
      const ids = (
        await db
          .select({ id: schema.bookings.id, code: schema.bookings.code })
          .from(schema.bookings)
      ).filter((r) => ["SW-AAAA-01", "SW-AAAA-02", "SW-AAAA-07"].includes(r.code));
      const done = await recordOutcomes(
        owner,
        ids.map((r) => r.id),
        { outcome: "completed" },
        { now: at(TODAY, "15:00") },
      );
      // 01 already completed (counts), 02 has started, 07 is a no-show already.
      expect(done).toEqual({ ok: true, data: { marked: 2, skipped: 1 } });

      const mias = ids.find((r) => r.code === "SW-AAAA-01")!.id;
      const staffTry = await recordOutcomes(
        staffer,
        [mias, "junk"],
        { outcome: "no_show" },
        { now: at(TODAY, "15:00") },
      );
      expect(staffTry).toEqual({ ok: true, data: { marked: 0, skipped: 2 } });
    });

    it("two overlapping bulk outcomes wait for each other instead of deadlocking", async () => {
      // Yesterday, an hour apart (45 min + buffer), inserted one at a time.
      const started: string[] = [];
      for (let i = 0; i < 8; i++) {
        const time = `${String(9 + i).padStart(2, "0")}:00`;
        started.push(await insert(`SW-OVER-0${i}`, at(nextDate(TODAY, -1), time)));
      }
      // Same bookings, picked in opposite orders (two tabs, two owners).
      const [first, second] = await Promise.all([
        recordOutcomes(owner, started, { outcome: "completed" }, { now: NOW }),
        recordOutcomes(owner, [...started].reverse(), { outcome: "completed" }, { now: NOW }),
      ]);
      // Marking the same way twice is a no-op success, so both report all eight.
      expect(first).toEqual({ ok: true, data: { marked: 8, skipped: 0 } });
      expect(second).toEqual({ ok: true, data: { marked: 8, skipped: 0 } });
    });
  });

  it("runs one query per page, however many rows (no N+1)", async () => {
    const few = await countQueries(() => list(owner, { range: "all" }));
    for (let i = 0; i < 30; i++) {
      await insert(`SW-BULK-${String(i).padStart(2, "0")}`, at(nextDate(TODAY, 40 + i), "10:00"));
    }
    const many = await countQueries(() => list(owner, { range: "all" }));
    expect(many.result.rows).toHaveLength(25);
    expect(many.queries).toBe(few.queries);
    // set_config + set role + the select.
    expect(many.queries).toBeLessThanOrEqual(5);
  });

  describe("CSV export", () => {
    const csv = async (actor: Actor, params: Record<string, string> = {}) => {
      let out = "";
      for await (const chunk of bookingsCsv(actor.claims, actor.businessId, filters(params), {
        zone: MANILA,
        now: NOW,
        today: TODAY,
        currency: "USD",
      })) {
        out += chunk;
      }
      return out;
    };

    it("exports the current filter in the business timezone, with a BOM and CRLF lines", async () => {
      const out = await csv(owner, { range: "today" });
      expect(out.startsWith("﻿")).toBe(true);
      const lines = out.slice(1).split("\r\n").filter(Boolean);
      expect(lines[0]).toBe(
        '"Code","Date","Start","End","Time zone","Customer","Email","Phone","Service","Staff","Status","Source","Price","Currency","Notes"',
      );
      expect(lines).toHaveLength(3);
      expect(lines[1]).toBe(
        `"SW-AAAA-01","${TODAY}","09:00","09:45","Asia/Manila","Ana Santos","${a.customer.email}",,"Haircut","Mia","Completed","Booking page","35.00","USD",`,
      );
      expect(lines[2]).toContain('"Jonah","Confirmed","AI receptionist"');
    });

    it("neutralises formulas in anything a customer typed", async () => {
      await insert("SW-EVIL-01", at(TODAY, "16:00"), {
        customerName: '=HYPERLINK("http://evil.example","Click")',
        customerPhone: "+1-555-0100",
        customerNotes: '@SUM(A1:A9)\n"quoted"',
      });
      await insert("SW-EVIL-02", at(TODAY, "17:00"), {
        customerName: "-2+3",
        customerNotes: "\t=1+1",
      });
      const out = await csv(owner, { range: "today", q: "SW-EVIL" });
      expect(out).toContain(`"'=HYPERLINK(""http://evil.example"",""Click"")"`);
      expect(out).toContain(`"'+1-555-0100"`);
      expect(out).toContain(`"'@SUM(A1:A9)\n""quoted"""`);
      expect(out).toContain(`"'-2+3"`);
      expect(out).toContain(`"'\t=1+1"`);
      expect(out).not.toMatch(/(^|,)"=/m);
    });

    it("streams large exports in batches and never leaks another business's bookings", async () => {
      expect((await csv(ownerB, { range: "all" })).split("\r\n").filter(Boolean)).toHaveLength(1);
      expect(
        (await csv({ ...ownerB, businessId: a.business.id }, { range: "all" }))
          .split("\r\n")
          .filter(Boolean),
      ).toHaveLength(1);
      expect((await csv(owner, { range: "all" })).split("\r\n").filter(Boolean)).toHaveLength(9);
    });

    it("walks batches by (starts_at, id): a booking added mid-export shifts nothing", async () => {
      // Two bookings at the same instant (Mia's and Jonah's): the id breaks the tie.
      await insert("SW-TIE-01", at(nextDate(TODAY, 1), "10:00"), { staffId: jonahId });
      const seen: string[] = [];
      let batches = 0;
      for await (const batch of bookingBatches(
        owner.claims,
        owner.businessId,
        filters({ range: "all" }),
        { zone: MANILA, now: NOW, today: TODAY },
        3,
      )) {
        batches++;
        seen.push(...batch.map((r) => r.code));
        // After the first batch, someone books a time before everything already exported.
        if (batches === 1) await insert("SW-LATE-01", at(nextDate(TODAY, -30), "10:00"));
      }
      expect(batches).toBe(3);
      expect(seen).toHaveLength(9);
      expect(new Set(seen).size).toBe(9);
      expect(seen).not.toContain("SW-LATE-01");
      expect(seen[0]).toBe("SW-AAAA-07"); // oldest first
    });

    it("never counts the whole result while exporting", async () => {
      const { onQuery } = await import("@/server/db/client");
      const selects: string[] = [];
      const stop = onQuery((query) => {
        if (/^select\b/i.test(query) && query.includes('"bookings"')) selects.push(query);
      });
      let exported = 0;
      try {
        for await (const batch of bookingBatches(
          owner.claims,
          owner.businessId,
          filters({ range: "all" }),
          { zone: MANILA, now: NOW, today: TODAY },
          3,
        )) {
          exported += batch.length;
        }
      } finally {
        stop();
      }
      expect(exported).toBe(8);
      expect(selects).toHaveLength(3); // 3 + 3 + 2
      for (const query of selects) expect(query).not.toMatch(/count\(/i);
    });
  });
});

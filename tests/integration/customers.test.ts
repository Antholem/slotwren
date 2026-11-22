import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { zonedInstant } from "@/lib/time-off";
import { saveCustomerNotes } from "@/server/catalog/customers";
import type { Actor } from "@/server/catalog/services";
import { withRls } from "@/server/db/client";
import { getCustomerProfile, listCustomers, paletteSearch } from "@/server/db/queries/customers";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import {
  bookingValues,
  connectTestDb,
  countQueries,
  createFixtureBusiness,
  pgErrorCode,
} from "../support/db";

/*
 * Customers: the list's aggregates (visits, last visit, total spent), the
 * profile, private notes (owners write, staff read, the database stamps who
 * and when), the ⌘K search, tenant isolation and query counts.
 */

const MANILA = "Asia/Manila";
const at = (date: string, time: string) => zonedInstant(date, time, MANILA);
const NOW = at("2026-12-02", "10:00");

type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;

describe("customers", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Fixture;
  let b: Fixture;
  let owner: Actor;
  let staffer: Actor;
  let ownerB: Actor;
  let benId: string;

  const book = (
    customerId: string,
    startsAt: Date,
    overrides: Partial<typeof schema.bookings.$inferInsert> = {},
  ) => db.insert(schema.bookings).values(bookingValues(a, startsAt, { customerId, ...overrides }));

  const list = (actor: Actor, q = "", sort: "name" | "spent" | "last_visit" | "visits" = "name") =>
    listCustomers(actor.claims, actor.businessId, {
      q,
      sort,
      dir: sort === "name" ? "asc" : "desc",
      limit: 25,
      offset: 0,
      now: NOW,
    });

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    const [ownerUser, staffUser, ownerUserB] = await Promise.all([
      users.create("cust-owner"),
      users.create("cust-staff"),
      users.create("cust-owner-b"),
    ]);
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerUser.sub, role: "owner" },
      { businessId: a.business.id, userId: staffUser.sub, role: "staff" },
      { businessId: b.business.id, userId: ownerUserB.sub, role: "owner" },
    ]);
    await db
      .update(schema.profiles)
      .set({ fullName: "Mia Reyes" })
      .where(eq(schema.profiles.id, ownerUser.sub));
    const [ben] = await db
      .insert(schema.customers)
      .values({ businessId: a.business.id, name: "Ben Ortiz", email: "ben@example.org" })
      .returning({ id: schema.customers.id });
    benId = ben!.id;
    owner = { claims: ownerUser, businessId: a.business.id, role: "owner" };
    staffer = { claims: staffUser, businessId: a.business.id, role: "staff" };
    ownerB = { claims: ownerUserB, businessId: b.business.id, role: "owner" };
  });

  beforeEach(async () => {
    await db.delete(schema.bookings).where(eq(schema.bookings.businessId, a.business.id));
    await db
      .update(schema.customers)
      .set({ notes: null, notesUpdatedAt: null, notesUpdatedBy: null })
      .where(eq(schema.customers.businessId, a.business.id));
    // Ana: two visits ($35 + $80), a no-show, a cancellation, one upcoming.
    await book(a.customer.id, at("2026-10-01", "10:00"), { status: "completed" });
    await book(a.customer.id, at("2026-11-01", "10:00"), { status: "completed", priceCents: 8000 });
    await book(a.customer.id, at("2026-11-15", "10:00"), { status: "no_show" });
    await book(a.customer.id, at("2026-11-20", "10:00"), { status: "cancelled" });
    await book(a.customer.id, at("2026-12-05", "10:00"));
    // Ben: one visit.
    await book(benId, at("2026-11-25", "12:00"), {
      status: "completed",
      customerName: "Ben Ortiz",
    });
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  describe("list", () => {
    it("adds up visits, last visit, total spent and upcoming per customer", async () => {
      const { rows, total } = await list(owner);
      expect(total).toBe(2);
      expect(rows).toEqual([
        {
          id: a.customer.id,
          name: "Ana Santos",
          email: a.customer.email,
          phone: null,
          visits: 2,
          lastVisit: at("2026-11-01", "10:00"),
          totalSpentCents: 11500,
          upcoming: 1,
        },
        {
          id: benId,
          name: "Ben Ortiz",
          email: "ben@example.org",
          phone: null,
          visits: 1,
          lastVisit: at("2026-11-25", "12:00"),
          totalSpentCents: 3500,
          upcoming: 0,
        },
      ]);
    });

    it("searches and sorts", async () => {
      expect((await list(owner, "EXAMPLE.ORG")).rows.map((r) => r.name)).toEqual(["Ben Ortiz"]);
      expect((await list(owner, "%")).rows).toEqual([]);
      expect((await list(owner, "", "spent")).rows.map((r) => r.name)).toEqual([
        "Ana Santos",
        "Ben Ortiz",
      ]);
      expect((await list(owner, "", "last_visit")).rows.map((r) => r.name)).toEqual([
        "Ben Ortiz",
        "Ana Santos",
      ]);
    });

    it("runs one query however many customers and bookings (no N+1)", async () => {
      const few = await countQueries(() => list(owner));
      const extra = await db
        .insert(schema.customers)
        .values(
          Array.from({ length: 20 }, (_, i) => ({
            businessId: a.business.id,
            name: `Zed ${i}`,
            email: `zed-${i}-${Date.now()}@example.com`,
          })),
        )
        .returning({ id: schema.customers.id });
      for (const [i, c] of extra.entries()) {
        await book(c.id, at("2026-09-01", `${String(8 + (i % 10)).padStart(2, "0")}:00`), {
          status: "completed",
          staffId: a.staff.id,
          code: `SW-Z-${i}`,
        });
      }
      const many = await countQueries(() => list(owner));
      expect(many.result.total).toBe(22);
      expect(many.queries).toBe(few.queries);
      await db.delete(schema.bookings).where(eq(schema.bookings.businessId, a.business.id));
      await db.execute(
        sql`delete from customers where business_id = ${a.business.id} and name like 'Zed %'`,
      );
    });

    it("never lists another business's customers", async () => {
      expect((await list(ownerB)).rows.map((r) => r.id)).not.toContain(a.customer.id);
      expect((await list({ ...ownerB, businessId: a.business.id })).rows).toEqual([]);
    });
  });

  describe("profile", () => {
    it("has the stats, upcoming bookings and history, in a fixed number of queries", async () => {
      const { result: profile, queries } = await countQueries(() =>
        getCustomerProfile(owner.claims, a.business.id, a.customer.id, NOW),
      );
      expect(profile).toMatchObject({
        name: "Ana Santos",
        stats: { totalSpentCents: 11500, visits: 2, noShows: 1, upcoming: 1 },
      });
      expect(profile!.upcoming.map((x) => x.startsAt)).toEqual([at("2026-12-05", "10:00")]);
      expect(profile!.history.map((x) => x.status)).toEqual([
        "cancelled",
        "no_show",
        "completed",
        "completed",
      ]);
      expect(queries).toBeLessThanOrEqual(6);
    });

    it("is readable by staff, and by nobody outside the business", async () => {
      expect(
        await getCustomerProfile(staffer.claims, a.business.id, a.customer.id, NOW),
      ).not.toBeNull();
      expect(await getCustomerProfile(ownerB.claims, a.business.id, a.customer.id, NOW)).toBeNull();
      expect(await getCustomerProfile(ownerB.claims, b.business.id, a.customer.id, NOW)).toBeNull();
    });
  });

  describe("private notes", () => {
    it("owners save them; the database stamps who and when", async () => {
      const saved = await saveCustomerNotes(owner, a.customer.id, {
        notes: "  Patch test 48 h before colour.  ",
      });
      expect(saved).toMatchObject({ ok: true, data: { notes: "Patch test 48 h before colour." } });
      const profile = await getCustomerProfile(owner.claims, a.business.id, a.customer.id, NOW);
      expect(profile).toMatchObject({
        notes: "Patch test 48 h before colour.",
        notesUpdatedBy: "Mia Reyes",
      });
      expect(profile!.notesUpdatedAt).toBeInstanceOf(Date);
    });

    it("staff read them but can't write them, through the app or the database", async () => {
      await saveCustomerNotes(owner, a.customer.id, { notes: "Owner's note" });
      expect(await saveCustomerNotes(staffer, a.customer.id, { notes: "x" })).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
      const direct = withRls(staffer.claims, (tx) =>
        tx
          .update(schema.customers)
          .set({ notes: "sneaky" })
          .where(eq(schema.customers.id, a.customer.id)),
      );
      await expect(direct).rejects.toSatisfy((e) => pgErrorCode(e) === "42501");
      // Staff still update other details (bookings fill in a phone), and the stamp stays.
      await withRls(staffer.claims, (tx) =>
        tx
          .update(schema.customers)
          .set({ phone: "+63 917 000 0000", notesUpdatedBy: staffer.claims.sub })
          .where(eq(schema.customers.id, a.customer.id)),
      );
      const [row] = await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, a.customer.id));
      expect(row).toMatchObject({
        notes: "Owner's note",
        phone: "+63 917 000 0000",
        notesUpdatedBy: owner.claims.sub,
      });
      await db
        .update(schema.customers)
        .set({ phone: null })
        .where(eq(schema.customers.id, a.customer.id));
    });

    it("validates length, and can't reach another business's customer", async () => {
      expect(
        await saveCustomerNotes(owner, a.customer.id, { notes: "x".repeat(2001) }),
      ).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
      expect(await saveCustomerNotes(ownerB, a.customer.id, { notes: "x" })).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
      expect(await saveCustomerNotes(owner, "nope", { notes: "x" })).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    });
  });

  it("⌘K finds customers by name or email and bookings by code, in this business only", async () => {
    const [code] = await db
      .select({ code: schema.bookings.code })
      .from(schema.bookings)
      .where(eq(schema.bookings.customerId, benId));
    const found = await paletteSearch(owner.claims, a.business.id, "ben");
    expect(found.customers.map((c) => c.name)).toEqual(["Ben Ortiz"]);
    expect(
      (await paletteSearch(owner.claims, a.business.id, code!.code.toLowerCase())).bookings,
    ).toEqual([expect.objectContaining({ code: code!.code, customerName: "Ben Ortiz" })]);
    expect(await paletteSearch(ownerB.claims, a.business.id, "ben")).toEqual({
      customers: [],
      bookings: [],
    });
    expect(await paletteSearch(owner.claims, a.business.id, "b")).toEqual({
      customers: [],
      bookings: [],
    });
  });
});

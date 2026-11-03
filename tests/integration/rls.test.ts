import { randomBytes, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type RlsClaims, type Transaction, withRls } from "@/server/db/client";
import { hasAnyMembership } from "@/server/db/queries/memberships";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import {
  bookingValues,
  connectTestDb,
  createFixtureBusiness,
  listTenantTables,
  pgErrorCode,
} from "../support/db";

/*
 * Tenant isolation through withRls, the dashboard path
 * (docs/proposal-foundation.md §4, docs/adr/0002-rls-strategy.md):
 * a member of business A can't read or write business B's rows, a user with no
 * membership sees nothing, and inside a business owners and staff get
 * different powers.
 *
 * How refusals show up in Postgres:
 * - INSERT blocked by a policy, or any statement without the grant: error 42501.
 * - UPDATE/DELETE on rows the policy hides: no error, 0 rows affected (RLS
 *   filters before the write). Those tests assert 0 rows *and* unchanged data.
 */

type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;

const { db, close } = connectTestDb();
// Every table with business_id, read from the catalog: a new tenant table is
// tested automatically, and fails "has a row in every tenant table" until
// fillTenant() below learns to create one.
const TENANT_TABLES = await listTenantTables(db);

const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";

/** Run `fn` as `user`; resolve to "ok" or the Postgres error code. */
function outcome(user: RlsClaims, fn: (tx: Transaction) => Promise<unknown>) {
  return withRls(user, fn).then(
    () => "ok",
    (error) => pgErrorCode(error) ?? String(error),
  );
}

/** Rows affected by a write, or the error code if Postgres refused it outright. */
function affected(user: RlsClaims, fn: (tx: Transaction) => Promise<unknown[]>) {
  return withRls(user, fn).then(
    (rows) => rows.length,
    (error) => pgErrorCode(error) ?? String(error),
  );
}

async function countRows(table: string, businessId: string) {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)} where business_id = ${businessId}`,
  );
  return rows[0]!.n;
}

/** All of a business's rows in a table, in a stable order for comparing. */
async function snapshot(table: string, businessId: string) {
  const rows = await db.execute(
    sql`select * from ${sql.identifier(table)} where business_id = ${businessId}`,
  );
  return rows.map((row) => JSON.stringify(row)).sort();
}

/** One row in every tenant table, so isolation checks have something to hide. */
async function fillTenant(f: Fixture, startsAt: Date) {
  const businessId = f.business.id;
  const hex = randomBytes(4).toString("hex");
  await db
    .insert(schema.staffServices)
    .values({ businessId, staffId: f.staff.id, serviceId: f.service.id });
  await db.insert(schema.availabilityRules).values({
    businessId,
    staffId: f.staff.id,
    weekday: 1,
    startTime: "09:00",
    endTime: "17:00",
  });
  await db.insert(schema.timeOff).values({
    businessId,
    staffId: f.staff.id,
    startsAt: new Date("2030-01-01T00:00:00Z"),
    endsAt: new Date("2030-01-02T00:00:00Z"),
  });
  const [booking] = await db.insert(schema.bookings).values(bookingValues(f, startsAt)).returning();
  await db
    .insert(schema.bookingEvents)
    .values({ businessId, bookingId: booking!.id, type: "created", actor: "customer" });
  await db.insert(schema.faqs).values({ businessId, question: "Parking?", answer: "Yes" });
  const [conversation] = await db
    .insert(schema.aiConversations)
    .values({ businessId, channel: "page" })
    .returning();
  await db
    .insert(schema.aiMessages)
    .values({ businessId, conversationId: conversation!.id, role: "user", content: "Hi" });
  await db
    .insert(schema.handoffRequests)
    .values({ businessId, name: "Ana", email: `ana-${hex}@example.com`, message: "Hello" });
  await db.insert(schema.subscriptions).values({
    businessId,
    stripeSubscriptionId: `sub_${hex}`,
    stripePriceId: "price_test",
    status: "active",
    currentPeriodEnd: new Date("2030-01-01T00:00:00Z"),
  });
  await db.insert(schema.staffInvites).values({
    businessId,
    staffId: f.staff.id,
    email: `invite-${hex}@example.com`,
    tokenHash: randomUUID(),
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  });
  return { booking: booking! };
}

describe("row level security", () => {
  const users = testUsers();

  let a: Fixture;
  let b: Fixture;
  let bBooking: typeof schema.bookings.$inferSelect;
  let aJonah: typeof schema.staff.$inferSelect; // A's second staff member, no login
  let aJonahBooking: typeof schema.bookings.$inferSelect;
  let aJonahRule: typeof schema.availabilityRules.$inferSelect;
  let aJonahTimeOff: typeof schema.timeOff.$inferSelect;
  let aMiaBooking: typeof schema.bookings.$inferSelect;
  let ownerA: RlsClaims;
  let staffA: RlsClaims; // linked to a.staff ("Mia")
  let ownerB: RlsClaims;
  let outsider: RlsClaims; // signed in, no membership anywhere

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    [ownerA, staffA, ownerB, outsider] = await Promise.all([
      users.create("owner-a"),
      users.create("staff-a"),
      users.create("owner-b"),
      users.create("outsider"),
    ]);

    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerA.sub, role: "owner" },
      { businessId: a.business.id, userId: staffA.sub, role: "staff" },
      { businessId: b.business.id, userId: ownerB.sub, role: "owner" },
    ]);
    await db
      .update(schema.staff)
      .set({ userId: staffA.sub })
      .where(eq(schema.staff.id, a.staff.id));
    aJonah = (
      await db
        .insert(schema.staff)
        .values({ businessId: a.business.id, name: "Jonah", color: "violet" })
        .returning()
    )[0]!;

    ({ booking: aMiaBooking } = await fillTenant(a, new Date("2030-02-01T01:00:00Z")));
    ({ booking: bBooking } = await fillTenant(b, new Date("2030-02-01T01:00:00Z")));
    aJonahBooking = (
      await db
        .insert(schema.bookings)
        .values(bookingValues(a, new Date("2030-02-01T01:00:00Z"), { staffId: aJonah.id }))
        .returning()
    )[0]!;
    aJonahRule = (
      await db
        .insert(schema.availabilityRules)
        .values({
          businessId: a.business.id,
          staffId: aJonah.id,
          weekday: 2,
          startTime: "10:00",
          endTime: "16:00",
        })
        .returning()
    )[0]!;
    aJonahTimeOff = (
      await db
        .insert(schema.timeOff)
        .values({
          businessId: a.business.id,
          staffId: aJonah.id,
          startsAt: new Date("2030-03-01T00:00:00Z"),
          endsAt: new Date("2030-03-02T00:00:00Z"),
          reason: "Holiday",
        })
        .returning()
    )[0]!;
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  it("finds the tenant tables in the catalog", () => {
    // Sanity check on the catalog query; the list itself is not maintained here.
    expect(TENANT_TABLES).toEqual(
      expect.arrayContaining([
        "staff",
        "services",
        "customers",
        "bookings",
        "availability_rules",
        "time_off",
        "faqs",
      ]),
    );
  });

  it("business B has a row in every tenant table (so the checks below mean something)", async () => {
    for (const table of TENANT_TABLES) {
      expect(await countRows(table, b.business.id), table).toBeGreaterThan(0);
    }
  });

  // Both kinds of member of A get the same answer from B: nothing.
  describe.each([
    ["an owner of A", () => ownerA],
    ["a staff member of A", () => staffA],
  ])("isolation: %s", (_who, member) => {
    it.each(TENANT_TABLES)("reads zero %s rows from B", async (table) => {
      const rows = await withRls(member(), (tx) =>
        tx.execute<{ n: number }>(
          sql`select count(*)::int as n from ${sql.identifier(table)} where business_id = ${b.business.id}`,
        ),
      );
      expect(rows[0]!.n).toBe(0);
    });

    it("can't see business B or its settings", async () => {
      const rows = await withRls(member(), (tx) =>
        tx.select().from(schema.businesses).where(eq(schema.businesses.id, b.business.id)),
      );
      expect(rows).toEqual([]);
    });

    it.each(TENANT_TABLES)("can't update or delete %s rows in B", async (table) => {
      const before = await snapshot(table, b.business.id);
      const id = sql.identifier(table);
      const bid = b.business.id;

      for (const statement of [
        sql`update ${id} set business_id = business_id where business_id = ${bid} returning 1`,
        sql`delete from ${id} where business_id = ${bid} returning 1`,
      ]) {
        const result = await affected(member(), (tx) => tx.execute(statement));
        // RLS hides every row (0 affected) or the grant is missing (42501).
        expect([0, INSUFFICIENT_PRIVILEGE]).toContain(result);
      }
      expect(await snapshot(table, b.business.id)).toEqual(before);
    });

    it("can't change business B's settings", async () => {
      const before = await db
        .select()
        .from(schema.businesses)
        .where(eq(schema.businesses.id, b.business.id));
      const changed = await affected(member(), (tx) =>
        tx
          .update(schema.businesses)
          .set({
            name: "Hijacked",
            minNoticeMin: 0,
            brandColor: "#000000",
            settings: { notifications: { ownerNewBookingEmail: false } },
          })
          .where(eq(schema.businesses.id, b.business.id))
          .returning(),
      );
      expect(changed).toBe(0);
      const deleted = await affected(member(), (tx) =>
        tx.delete(schema.businesses).where(eq(schema.businesses.id, b.business.id)).returning(),
      );
      expect(deleted).toBe(0);
      expect(
        await db.select().from(schema.businesses).where(eq(schema.businesses.id, b.business.id)),
      ).toEqual(before);
    });

    const bid = () => b.business.id;
    const crossTenantInserts: [string, (tx: Transaction) => Promise<unknown>][] = [
      [
        "services",
        (tx) =>
          tx.insert(schema.services).values({ businessId: bid(), name: "X", durationMin: 30 }),
      ],
      [
        "staff",
        (tx) => tx.insert(schema.staff).values({ businessId: bid(), name: "X", color: "teal" }),
      ],
      [
        "customers",
        (tx) =>
          tx
            .insert(schema.customers)
            .values({ businessId: bid(), name: "X", email: "x@example.com" }),
      ],
      [
        "faqs",
        (tx) => tx.insert(schema.faqs).values({ businessId: bid(), question: "Q", answer: "A" }),
      ],
      [
        "availability_rules",
        (tx) =>
          tx.insert(schema.availabilityRules).values({
            businessId: bid(),
            staffId: b.staff.id,
            weekday: 2,
            startTime: "09:00",
            endTime: "10:00",
          }),
      ],
      [
        "time_off",
        (tx) =>
          tx.insert(schema.timeOff).values({
            businessId: bid(),
            staffId: b.staff.id,
            startsAt: new Date("2031-01-01T00:00:00Z"),
            endsAt: new Date("2031-01-02T00:00:00Z"),
          }),
      ],
      [
        "bookings",
        (tx) =>
          tx.insert(schema.bookings).values(bookingValues(b, new Date("2031-03-01T01:00:00Z"))),
      ],
      [
        "booking_events",
        (tx) =>
          tx.insert(schema.bookingEvents).values({
            businessId: bid(),
            bookingId: bBooking.id,
            type: "completed",
            actor: "staff",
          }),
      ],
      [
        "memberships",
        (tx) =>
          tx
            .insert(schema.memberships)
            .values({ businessId: bid(), userId: member().sub, role: "owner" }),
      ],
      [
        "staff_invites",
        (tx) =>
          tx.insert(schema.staffInvites).values({
            businessId: bid(),
            staffId: b.staff.id,
            email: "x@example.com",
            tokenHash: randomUUID(),
            expiresAt: new Date("2031-01-01T00:00:00Z"),
          }),
      ],
    ];

    it.each(crossTenantInserts)(
      "gets a permission error inserting %s rows into B",
      async (_t, insert) => {
        expect(await outcome(member(), insert)).toBe(INSUFFICIENT_PRIVILEGE);
      },
    );
  });

  describe("a signed-in user with no membership", () => {
    it("sees nothing at all, in any business", async () => {
      const seen: Record<string, number> = {};
      await withRls(outsider, async (tx) => {
        for (const table of [...TENANT_TABLES, "businesses"]) {
          const rows = await tx.execute<{ n: number }>(
            sql`select count(*)::int as n from ${sql.identifier(table)}`,
          );
          seen[table] = rows[0]!.n;
        }
      });
      // Reads every row of every table unfiltered, including the seeded demo business.
      expect(
        Object.values(seen).every((n) => n === 0),
        JSON.stringify(seen),
      ).toBe(true);
      expect(await hasAnyMembership(outsider)).toBe(false);
    });

    it("sees only their own profile", async () => {
      const profiles = await withRls(outsider, (tx) => tx.select().from(schema.profiles));
      expect(profiles.map((p) => p.id)).toEqual([outsider.sub]);
    });

    it("can't write into an existing business", async () => {
      expect(
        await outcome(outsider, (tx) =>
          tx
            .insert(schema.services)
            .values({ businessId: a.business.id, name: "X", durationMin: 30 }),
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
      expect(
        await affected(outsider, (tx) =>
          tx
            .update(schema.businesses)
            .set({ name: "Mine now" })
            .where(eq(schema.businesses.id, a.business.id))
            .returning(),
        ),
      ).toBe(0);
    });
  });

  describe("owners", () => {
    it("can edit their business settings", async () => {
      const updated = await withRls(ownerA, (tx) =>
        tx
          .update(schema.businesses)
          .set({ minNoticeMin: 60 })
          .where(eq(schema.businesses.id, a.business.id))
          .returning({ minNoticeMin: schema.businesses.minNoticeMin }),
      );
      expect(updated).toEqual([{ minNoticeMin: 60 }]);
    });

    it("can't change their plan or Stripe customer (billing webhooks do)", async () => {
      for (const set of [{ plan: "pro" as const }, { stripeCustomerId: "cus_fake" }]) {
        const result = await outcome(ownerA, (tx) =>
          tx.update(schema.businesses).set(set).where(eq(schema.businesses.id, a.business.id)),
        );
        expect(result).toBe(INSUFFICIENT_PRIVILEGE);
      }
    });

    it("can read their subscription and manage invites", async () => {
      const subs = await withRls(ownerA, (tx) =>
        tx
          .select()
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.businessId, a.business.id)),
      );
      expect(subs).toHaveLength(1);
      const invites = await withRls(ownerA, (tx) =>
        tx
          .select()
          .from(schema.staffInvites)
          .where(eq(schema.staffInvites.businessId, a.business.id)),
      );
      expect(invites).toHaveLength(1);
    });

    it("can manage anyone's schedule", async () => {
      const result = await outcome(ownerA, (tx) =>
        tx.insert(schema.availabilityRules).values({
          businessId: a.business.id,
          staffId: aJonah.id,
          weekday: 3,
          startTime: "13:00",
          endTime: "18:00",
        }),
      );
      expect(result).toBe("ok");
    });

    it("can't add an arbitrary user to their business directly", async () => {
      const result = await outcome(ownerA, (tx) =>
        tx
          .insert(schema.memberships)
          .values({ businessId: a.business.id, userId: ownerB.sub, role: "staff" }),
      );
      expect(result).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("can't remove or demote the last owner", async () => {
      const where = and(
        eq(schema.memberships.businessId, a.business.id),
        eq(schema.memberships.userId, ownerA.sub),
      );
      expect(await outcome(ownerA, (tx) => tx.delete(schema.memberships).where(where))).toBe(
        CHECK_VIOLATION,
      );
      expect(
        await outcome(ownerA, (tx) =>
          tx.update(schema.memberships).set({ role: "staff" }).where(where),
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  describe("staff", () => {
    it("can read the team's business data", async () => {
      const [services, bookings, customers] = await withRls(staffA, async (tx) => [
        await tx
          .select()
          .from(schema.services)
          .where(eq(schema.services.businessId, a.business.id)),
        await tx
          .select()
          .from(schema.bookings)
          .where(eq(schema.bookings.businessId, a.business.id)),
        await tx
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.businessId, a.business.id)),
      ]);
      expect(services).toHaveLength(1);
      expect(bookings.map((row) => row.id).sort()).toEqual(
        [aMiaBooking.id, aJonahBooking.id].sort(),
      );
      expect(customers).toHaveLength(1);
    });

    it("can't read billing or invites", async () => {
      const [subs, invites] = await withRls(staffA, async (tx) => [
        await tx.select().from(schema.subscriptions),
        await tx.select().from(schema.staffInvites),
      ]);
      expect(subs).toEqual([]);
      expect(invites).toEqual([]);
    });

    it("can't change billing: plan, Stripe customer or subscription", async () => {
      for (const set of [{ plan: "pro" as const }, { stripeCustomerId: "cus_fake" }]) {
        expect(
          await outcome(staffA, (tx) =>
            tx.update(schema.businesses).set(set).where(eq(schema.businesses.id, a.business.id)),
          ),
        ).toBe(INSUFFICIENT_PRIVILEGE);
      }
      expect(
        await outcome(staffA, (tx) =>
          tx
            .update(schema.subscriptions)
            .set({ status: "canceled" })
            .where(eq(schema.subscriptions.businessId, a.business.id)),
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
      expect(
        await outcome(staffA, (tx) =>
          tx.delete(schema.subscriptions).where(eq(schema.subscriptions.businessId, a.business.id)),
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("can't change business settings", async () => {
      const before = await db
        .select()
        .from(schema.businesses)
        .where(eq(schema.businesses.id, a.business.id));
      const changed = await affected(staffA, (tx) =>
        tx
          .update(schema.businesses)
          .set({
            name: "Staff rename",
            minNoticeMin: 0,
            cancellationWindowHours: 0,
            settings: { notifications: { ownerNewBookingEmail: false } },
          })
          .where(eq(schema.businesses.id, a.business.id))
          .returning(),
      );
      expect(changed).toBe(0);
      expect(
        await db.select().from(schema.businesses).where(eq(schema.businesses.id, a.business.id)),
      ).toEqual(before);
    });

    it("can't create, change or delete services", async () => {
      expect(
        await outcome(staffA, (tx) =>
          tx
            .insert(schema.services)
            .values({ businessId: a.business.id, name: "X", durationMin: 30 }),
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
      const repriced = await affected(staffA, (tx) =>
        tx
          .update(schema.services)
          .set({ priceCents: 1 })
          .where(eq(schema.services.id, a.service.id))
          .returning(),
      );
      const deleted = await affected(staffA, (tx) =>
        tx.delete(schema.services).where(eq(schema.services.id, a.service.id)).returning(),
      );
      expect([repriced, deleted]).toEqual([0, 0]);
      const [service] = await db
        .select()
        .from(schema.services)
        .where(eq(schema.services.id, a.service.id));
      expect(service?.priceCents).toBe(a.service.priceCents);
    });

    it("can manage their own hours", async () => {
      const ownHours = await outcome(staffA, (tx) =>
        tx.insert(schema.availabilityRules).values({
          businessId: a.business.id,
          staffId: a.staff.id,
          weekday: 4,
          startTime: "09:00",
          endTime: "12:00",
        }),
      );
      expect(ownHours).toBe("ok");
    });

    it("can't add to another staff member's schedule", async () => {
      const colleagueHours = await outcome(staffA, (tx) =>
        tx.insert(schema.availabilityRules).values({
          businessId: a.business.id,
          staffId: aJonah.id,
          weekday: 4,
          startTime: "09:00",
          endTime: "12:00",
        }),
      );
      expect(colleagueHours).toBe(INSUFFICIENT_PRIVILEGE);

      const colleagueTimeOff = await outcome(staffA, (tx) =>
        tx.insert(schema.timeOff).values({
          businessId: a.business.id,
          staffId: aJonah.id,
          startsAt: new Date("2031-05-01T00:00:00Z"),
          endsAt: new Date("2031-05-02T00:00:00Z"),
        }),
      );
      expect(colleagueTimeOff).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("can't change or delete another staff member's hours or time off", async () => {
      const results = await Promise.all([
        affected(staffA, (tx) =>
          tx
            .update(schema.availabilityRules)
            .set({ endTime: "23:00" })
            .where(eq(schema.availabilityRules.id, aJonahRule.id))
            .returning(),
        ),
        affected(staffA, (tx) =>
          tx
            .delete(schema.availabilityRules)
            .where(eq(schema.availabilityRules.id, aJonahRule.id))
            .returning(),
        ),
        affected(staffA, (tx) =>
          tx
            .update(schema.timeOff)
            .set({ reason: "Changed" })
            .where(eq(schema.timeOff.id, aJonahTimeOff.id))
            .returning(),
        ),
        affected(staffA, (tx) =>
          tx.delete(schema.timeOff).where(eq(schema.timeOff.id, aJonahTimeOff.id)).returning(),
        ),
      ]);
      expect(results).toEqual([0, 0, 0, 0]);

      const [rule] = await db
        .select()
        .from(schema.availabilityRules)
        .where(eq(schema.availabilityRules.id, aJonahRule.id));
      const [off] = await db
        .select()
        .from(schema.timeOff)
        .where(eq(schema.timeOff.id, aJonahTimeOff.id));
      expect(rule).toEqual(aJonahRule);
      expect(off).toEqual(aJonahTimeOff);
    });

    it("can't move their own hours onto a colleague", async () => {
      const moved = await outcome(staffA, (tx) =>
        tx
          .update(schema.availabilityRules)
          .set({ staffId: aJonah.id })
          .where(eq(schema.availabilityRules.staffId, a.staff.id)),
      );
      expect(moved).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("can update their own bookings, not a colleague's, and can't reassign them", async () => {
      const own = await withRls(staffA, (tx) =>
        tx
          .update(schema.bookings)
          .set({ status: "completed" })
          .where(eq(schema.bookings.id, aMiaBooking.id))
          .returning({ id: schema.bookings.id }),
      );
      expect(own).toEqual([{ id: aMiaBooking.id }]);

      const colleagues = await affected(staffA, (tx) =>
        tx
          .update(schema.bookings)
          .set({ status: "no_show" })
          .where(eq(schema.bookings.id, aJonahBooking.id))
          .returning(),
      );
      expect(colleagues).toBe(0);

      const handOff = await outcome(staffA, (tx) =>
        tx
          .update(schema.bookings)
          .set({ staffId: aJonah.id })
          .where(eq(schema.bookings.id, aMiaBooking.id)),
      );
      expect(handOff).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("can't change anyone's role", async () => {
      const promoted = await affected(staffA, (tx) =>
        tx
          .update(schema.memberships)
          .set({ role: "owner" })
          .where(eq(schema.memberships.userId, staffA.sub))
          .returning(),
      );
      expect(promoted).toBe(0);
    });
  });

  describe("everyone signed in", () => {
    it("can create a business and becomes its owner", async () => {
      const founder = await users.create("founder");
      const slug = `rls-${randomBytes(4).toString("hex")}`;
      // The id is generated here, not RETURNING'd: RETURNING is checked against
      // the select policy before the trigger makes the founder a member.
      const id = randomUUID();
      const created = await withRls(founder, async (tx) => {
        await tx
          .insert(schema.businesses)
          .values({ id, slug, name: "New Studio", timezone: "Europe/London" });
        return tx.select().from(schema.businesses).where(eq(schema.businesses.id, id));
      });
      try {
        expect(created).toHaveLength(1);
        expect(await hasAnyMembership(founder)).toBe(true);
        const [membership] = await db
          .select()
          .from(schema.memberships)
          .where(eq(schema.memberships.businessId, id));
        expect(membership).toMatchObject({ userId: founder.sub, role: "owner" });
      } finally {
        await db.delete(schema.businesses).where(eq(schema.businesses.slug, slug));
      }
    });

    it("can't create a business already on the Pro plan", async () => {
      const result = await outcome(ownerA, (tx) =>
        tx.insert(schema.businesses).values({
          slug: `rls-${randomBytes(4).toString("hex")}`,
          name: "Free Pro",
          timezone: "Europe/London",
          plan: "pro",
        }),
      );
      expect(result).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("can't touch Stripe webhook events or truncate tables", async () => {
      expect(await outcome(ownerA, (tx) => tx.select().from(schema.stripeEvents))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
      expect(await outcome(ownerA, (tx) => tx.execute(sql`truncate table public.faqs`))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });
});

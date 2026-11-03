import { randomBytes, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type RlsClaims, type Transaction, withRls } from "@/server/db/client";
import { hasAnyMembership } from "@/server/db/queries/memberships";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, createFixtureBusiness, pgErrorCode } from "../support/db";

/*
 * RLS through withRls, the dashboard path (docs/proposal-foundation.md §4):
 * a member of business A can't read or write business B's rows, and inside a
 * business owners and staff get different powers.
 */

type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;

// Every tenant table, by its SQL name. businesses itself is checked separately.
const TENANT_TABLES = [
  "memberships",
  "staff",
  "staff_invites",
  "services",
  "staff_services",
  "availability_rules",
  "time_off",
  "customers",
  "bookings",
  "booking_events",
  "faqs",
  "ai_conversations",
  "ai_messages",
  "handoff_requests",
  "subscriptions",
] as const;

const INSUFFICIENT_PRIVILEGE = "42501"; // RLS WITH CHECK failures and missing grants
const CHECK_VIOLATION = "23514";

/** Run `fn` as `user`; resolve to "ok" or the Postgres error code. */
function outcome(user: RlsClaims, fn: (tx: Transaction) => Promise<unknown>) {
  return withRls(user, fn).then(
    () => "ok",
    (error) => pgErrorCode(error) ?? String(error),
  );
}

/** One row in every tenant table, so isolation checks have something to hide. */
async function fillTenant(db: ReturnType<typeof connectTestDb>["db"], f: Fixture, startsAt: Date) {
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
  const { db, close } = connectTestDb();
  const users = testUsers();

  let a: Fixture;
  let b: Fixture;
  let bBooking: typeof schema.bookings.$inferSelect;
  let aJonah: typeof schema.staff.$inferSelect; // A's second staff member, no login
  let aJonahBooking: typeof schema.bookings.$inferSelect;
  let aMiaBooking: typeof schema.bookings.$inferSelect;
  let ownerA: RlsClaims;
  let staffA: RlsClaims; // linked to a.staff ("Mia")
  let ownerB: RlsClaims;

  const countRows = async (table: string, businessId: string) => {
    const rows = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)} where business_id = ${businessId}`,
    );
    return rows[0]!.n;
  };

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    [ownerA, staffA, ownerB] = await Promise.all([
      users.create("owner-a"),
      users.create("staff-a"),
      users.create("owner-b"),
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

    ({ booking: aMiaBooking } = await fillTenant(db, a, new Date("2030-02-01T01:00:00Z")));
    ({ booking: bBooking } = await fillTenant(db, b, new Date("2030-02-01T01:00:00Z")));
    aJonahBooking = (
      await db
        .insert(schema.bookings)
        .values(bookingValues(a, new Date("2030-02-01T01:00:00Z"), { staffId: aJonah.id }))
        .returning()
    )[0]!;
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  describe("isolation between businesses", () => {
    it("business B has a row in every tenant table (so the checks below mean something)", async () => {
      for (const table of TENANT_TABLES) {
        expect(await countRows(table, b.business.id), table).toBeGreaterThan(0);
      }
    });

    it.each(TENANT_TABLES)("an owner of A reads zero %s rows from B", async (table) => {
      const rows = await withRls(ownerA, (tx) =>
        tx.execute<{ n: number }>(
          sql`select count(*)::int as n from ${sql.identifier(table)} where business_id = ${b.business.id}`,
        ),
      );
      expect(rows[0]!.n).toBe(0);
    });

    it("an owner of A can't see business B itself", async () => {
      const rows = await withRls(ownerA, (tx) =>
        tx.select().from(schema.businesses).where(eq(schema.businesses.id, b.business.id)),
      );
      expect(rows).toEqual([]);
    });

    it.each(TENANT_TABLES)("an owner of A can't update or delete %s rows in B", async (table) => {
      const before = await countRows(table, b.business.id);
      const id = sql.identifier(table);
      const bid = b.business.id;

      for (const statement of [
        sql`update ${id} set business_id = business_id where business_id = ${bid} returning 1`,
        sql`delete from ${id} where business_id = ${bid} returning 1`,
      ]) {
        const result = await withRls(ownerA, (tx) => tx.execute(statement)).then(
          (rows) => rows.length,
          (error) => pgErrorCode(error),
        );
        // Either RLS filters every row out (0 affected) or the grant is missing.
        expect([0, INSUFFICIENT_PRIVILEGE]).toContain(result);
      }
      expect(await countRows(table, b.business.id)).toBe(before);
    });

    it("an owner of A can't rename business B", async () => {
      const updated = await withRls(ownerA, (tx) =>
        tx
          .update(schema.businesses)
          .set({ name: "Hijacked" })
          .where(eq(schema.businesses.id, b.business.id))
          .returning(),
      );
      expect(updated).toEqual([]);
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
            .values({ businessId: bid(), userId: ownerA.sub, role: "owner" }),
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
      "an owner of A can't insert %s rows into B",
      async (_table, insert) => {
        expect(await outcome(ownerA, insert)).toBe(INSUFFICIENT_PRIVILEGE);
      },
    );
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

    it("can't change business settings, services or staff", async () => {
      const renamed = await withRls(staffA, (tx) =>
        tx
          .update(schema.businesses)
          .set({ name: "Staff rename" })
          .where(eq(schema.businesses.id, a.business.id))
          .returning(),
      );
      expect(renamed).toEqual([]);
      expect(
        await outcome(staffA, (tx) =>
          tx
            .insert(schema.services)
            .values({ businessId: a.business.id, name: "X", durationMin: 30 }),
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
      const repriced = await withRls(staffA, (tx) =>
        tx
          .update(schema.services)
          .set({ priceCents: 1 })
          .where(eq(schema.services.id, a.service.id))
          .returning(),
      );
      expect(repriced).toEqual([]);
    });

    it("can manage their own hours and time off, not a colleague's", async () => {
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

    it("can update their own bookings, not a colleague's, and can't reassign them", async () => {
      const own = await withRls(staffA, (tx) =>
        tx
          .update(schema.bookings)
          .set({ status: "completed" })
          .where(eq(schema.bookings.id, aMiaBooking.id))
          .returning({ id: schema.bookings.id }),
      );
      expect(own).toEqual([{ id: aMiaBooking.id }]);

      const colleagues = await withRls(staffA, (tx) =>
        tx
          .update(schema.bookings)
          .set({ status: "no_show" })
          .where(eq(schema.bookings.id, aJonahBooking.id))
          .returning(),
      );
      expect(colleagues).toEqual([]);

      const handOff = await outcome(staffA, (tx) =>
        tx
          .update(schema.bookings)
          .set({ staffId: aJonah.id })
          .where(eq(schema.bookings.id, aMiaBooking.id)),
      );
      expect(handOff).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("can't change anyone's role", async () => {
      const promoted = await withRls(staffA, (tx) =>
        tx
          .update(schema.memberships)
          .set({ role: "owner" })
          .where(eq(schema.memberships.userId, staffA.sub))
          .returning(),
      );
      expect(promoted).toEqual([]);
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

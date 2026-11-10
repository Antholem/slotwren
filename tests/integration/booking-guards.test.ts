import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type RlsClaims, withRls } from "@/server/db/client";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, createFixtureBusiness, pgErrorCode } from "../support/db";

/*
 * The floor under src/server/booking/service.ts for signed-in members
 * (migration 20261110130331_booking_guards.sql):
 * - booking_events record whoever is signed in as the actor, whatever is sent;
 * - nobody changes a booking's code, source or manage-token hash, and only
 *   owners change its price.
 */

describe("booking guards", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let owner: RlsClaims;
  let staffer: RlsClaims;
  let bookingId: string;

  const bookingRow = async () =>
    (await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId)))[0]!;
  const outcome = (claims: RlsClaims, change: Partial<typeof schema.bookings.$inferInsert>) =>
    withRls(claims, (tx) =>
      tx.update(schema.bookings).set(change).where(eq(schema.bookings.id, bookingId)),
    )
      .then(() => "updated")
      .catch(pgErrorCode);

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    [owner, staffer] = await Promise.all([
      users.create("guard-owner"),
      users.create("guard-staff"),
    ]);
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: owner.sub, role: "owner" },
      { businessId: a.business.id, userId: staffer.sub, role: "staff" },
    ]);
    // The fixture's staff member is the staff user, so the booking is "theirs".
    await db
      .update(schema.staff)
      .set({ userId: staffer.sub })
      .where(eq(schema.staff.id, a.staff.id));
    const [booking] = await db
      .insert(schema.bookings)
      .values(bookingValues(a, new Date("2031-05-01T01:00:00Z")))
      .returning({ id: schema.bookings.id });
    bookingId = booking!.id;
  });

  afterAll(async () => {
    await a?.cleanup();
    await users.cleanup();
    await close();
  });

  describe("audit trail", () => {
    it("records the signed-in member as the actor, whatever they send", async () => {
      const [event] = await withRls(staffer, (tx) =>
        tx
          .insert(schema.bookingEvents)
          .values({
            businessId: a.business.id,
            bookingId,
            type: "cancelled",
            actor: "customer", // forged
            actorUserId: owner.sub, // forged
          })
          .returning({
            actor: schema.bookingEvents.actor,
            actorUserId: schema.bookingEvents.actorUserId,
          }),
      );
      expect(event).toEqual({ actor: "staff", actorUserId: staffer.sub });
    });

    it("leaves server paths without a user to set their own actor", async () => {
      const [event] = await db
        .insert(schema.bookingEvents)
        .values({ businessId: a.business.id, bookingId, type: "created", actor: "customer" })
        .returning({
          actor: schema.bookingEvents.actor,
          actorUserId: schema.bookingEvents.actorUserId,
        });
      expect(event).toEqual({ actor: "customer", actorUserId: null });
    });
  });

  describe("what members may change on a booking", () => {
    it("staff update their own booking's status and notes", async () => {
      expect(await outcome(staffer, { status: "completed", customerNotes: "Arrived early" })).toBe(
        "updated",
      );
      expect(await bookingRow()).toMatchObject({
        status: "completed",
        customerNotes: "Arrived early",
      });
    });

    it("staff can't change the price", async () => {
      const before = (await bookingRow()).priceCents;
      expect(await outcome(staffer, { priceCents: 1 })).toBe("42501");
      expect((await bookingRow()).priceCents).toBe(before);
    });

    it("owners can change the price", async () => {
      expect(await outcome(owner, { priceCents: 4000 })).toBe("updated");
      expect((await bookingRow()).priceCents).toBe(4000);
    });

    it.each([
      ["code", { code: "SW-FAKE-00" }],
      ["manage-token hash", { manageTokenHash: "0".repeat(64) }],
      ["source", { source: "ai" as const }],
      ["business", { businessId: "00000000-0000-0000-0000-000000000000" }],
    ])("nobody signed in changes its %s", async (_field, change) => {
      const before = await bookingRow();
      expect(await outcome(owner, change)).toBe("42501");
      expect(await outcome(staffer, change)).toBe("42501");
      const after = await bookingRow();
      expect(after.code).toBe(before.code);
      expect(after.manageTokenHash).toBe(before.manageTokenHash);
      expect(after.source).toBe(before.source);
    });
  });
});

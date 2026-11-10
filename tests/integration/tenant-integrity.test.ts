import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/server/db/schema";

import { bookingValues, connectTestDb, createFixtureBusiness, pgErrorCode } from "../support/db";

// Composite (id, business_id) foreign keys: a row can't point at another tenant's data.
describe("cross-tenant foreign keys", () => {
  const { db, close } = connectTestDb();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let b: Awaited<ReturnType<typeof createFixtureBusiness>>;

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await close();
  });

  it("refuses a booking in business A that uses business B's staff member", async () => {
    const values = bookingValues(a, new Date("2026-11-03T02:00:00Z"), { staffId: b.staff.id });
    const code = await db
      .insert(schema.bookings)
      .values(values)
      .then(() => "inserted")
      .catch(pgErrorCode);
    expect(code).toBe("23503"); // foreign_key_violation
  });

  it("refuses assigning business B's service to business A's staff", async () => {
    const code = await db
      .insert(schema.staffServices)
      .values({ businessId: a.business.id, staffId: a.staff.id, serviceId: b.service.id })
      .then(() => "inserted")
      .catch(pgErrorCode);
    expect(code).toBe("23503");
  });

  describe("bookings, audit trail and AI rows", () => {
    let bBooking: { id: string };
    let bConversation: { id: string };

    beforeAll(async () => {
      [bBooking] = (await db
        .insert(schema.bookings)
        .values(bookingValues(b, new Date("2031-04-01T01:00:00Z")))
        .returning({ id: schema.bookings.id })) as [{ id: string }];
      [bConversation] = (await db
        .insert(schema.aiConversations)
        .values({ businessId: b.business.id, channel: "page" })
        .returning({ id: schema.aiConversations.id })) as [{ id: string }];
    });

    const attempt = (write: Promise<unknown>) => write.then(() => "inserted").catch(pgErrorCode);

    it.each([
      [
        "an audit event on B's booking",
        () =>
          db.insert(schema.bookingEvents).values({
            businessId: a.business.id,
            bookingId: bBooking.id,
            type: "created",
            actor: "system",
          }),
      ],
      [
        "an AI message in B's conversation",
        () =>
          db.insert(schema.aiMessages).values({
            businessId: a.business.id,
            conversationId: bConversation.id,
            role: "user",
          }),
      ],
      [
        "a conversation linked to B's customer",
        () =>
          db
            .insert(schema.aiConversations)
            .values({ businessId: a.business.id, channel: "page", customerId: b.customer.id }),
      ],
      [
        "a hand-off linked to B's conversation",
        () =>
          db.insert(schema.handoffRequests).values({
            businessId: a.business.id,
            conversationId: bConversation.id,
            name: "Ana",
            email: "ana@example.com",
            message: "Hi",
          }),
      ],
      [
        "a hand-off linked to B's customer",
        () =>
          db.insert(schema.handoffRequests).values({
            businessId: a.business.id,
            customerId: b.customer.id,
            name: "Ana",
            email: "ana@example.com",
            message: "Hi",
          }),
      ],
      [
        "a booking linked to B's AI conversation",
        () =>
          db.insert(schema.bookings).values({
            ...bookingValues(a, new Date("2031-04-02T01:00:00Z")),
            aiConversationId: bConversation.id,
          }),
      ],
    ])("refuses %s", async (_case, write) => {
      expect(await attempt(write())).toBe("23503");
    });

    it("clears only the link when the linked row goes", async () => {
      const [conversation] = await db
        .insert(schema.aiConversations)
        .values({ businessId: b.business.id, channel: "page", customerId: b.customer.id })
        .returning({ id: schema.aiConversations.id });
      const [handoff] = await db
        .insert(schema.handoffRequests)
        .values({
          businessId: b.business.id,
          conversationId: conversation!.id,
          name: "Ana",
          email: "ana@example.com",
          message: "Hi",
        })
        .returning({ id: schema.handoffRequests.id });

      await db
        .delete(schema.aiConversations)
        .where(eq(schema.aiConversations.id, conversation!.id));
      const [row] = await db
        .select({
          businessId: schema.handoffRequests.businessId,
          conversationId: schema.handoffRequests.conversationId,
        })
        .from(schema.handoffRequests)
        .where(eq(schema.handoffRequests.id, handoff!.id));
      expect(row).toEqual({ businessId: b.business.id, conversationId: null });
    });
  });
});

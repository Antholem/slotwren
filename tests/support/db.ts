import { randomBytes, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";

/** Direct (RLS-bypassing) connection for setting up and tearing down fixtures. */
export function connectTestDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  const client = postgres(url, { prepare: false, max: 4, onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

export type TestDb = ReturnType<typeof connectTestDb>["db"];

/** A throwaway business with one staff member, one service and one customer. */
export async function createFixtureBusiness(db: TestDb) {
  const suffix = randomBytes(4).toString("hex");
  const [business] = await db
    .insert(schema.businesses)
    .values({ slug: `test-${suffix}`, name: `Test ${suffix}`, timezone: "Asia/Manila" })
    .returning();
  const businessId = business!.id;

  const [staffMember] = await db
    .insert(schema.staff)
    .values({ businessId, name: "Mia", color: "teal" })
    .returning();
  const [service] = await db
    .insert(schema.services)
    .values({ businessId, name: "Haircut", durationMin: 45, priceCents: 3500, bufferAfterMin: 15 })
    .returning();
  const [customer] = await db
    .insert(schema.customers)
    .values({ businessId, name: "Ana Santos", email: `ana-${suffix}@example.com` })
    .returning();

  return {
    business: business!,
    staff: staffMember!,
    service: service!,
    customer: customer!,
    cleanup: () => db.delete(schema.businesses).where(eq(schema.businesses.id, businessId)),
  };
}

/** Booking row with the buffered range computed from the fixture service. */
export function bookingValues(
  fixture: Awaited<ReturnType<typeof createFixtureBusiness>>,
  startsAt: Date,
  overrides: Partial<typeof schema.bookings.$inferInsert> = {},
): typeof schema.bookings.$inferInsert {
  const { service } = fixture;
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);
  return {
    businessId: fixture.business.id,
    code: `SW-${randomBytes(3).toString("hex").toUpperCase()}`,
    serviceId: service.id,
    staffId: fixture.staff.id,
    customerId: fixture.customer.id,
    startsAt,
    endsAt,
    bufferedStart: new Date(startsAt.getTime() - service.bufferBeforeMin * 60_000),
    bufferedEnd: new Date(endsAt.getTime() + service.bufferAfterMin * 60_000),
    source: "page",
    priceCents: service.priceCents,
    manageTokenHash: randomUUID(),
    ...overrides,
  };
}

/** Postgres error code from a failed query (postgres-js may wrap it in `cause`). */
export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}

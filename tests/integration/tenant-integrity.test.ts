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
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/server/db/schema";

import { bookingValues, connectTestDb, createFixtureBusiness, pgErrorCode } from "../support/db";

// 10:00 Manila on a fixed date; the fixture service is 45 min + 15 min buffer after.
const TEN_AM = new Date("2026-11-03T02:00:00Z");
const at = (minutesAfterTen: number) => new Date(TEN_AM.getTime() + minutesAfterTen * 60_000);

describe("no_double_booking exclusion constraint", () => {
  const { db, close } = connectTestDb();
  let fixture: Awaited<ReturnType<typeof createFixtureBusiness>>;

  beforeAll(async () => {
    fixture = await createFixtureBusiness(db);
    // Occupies 10:00–11:00 including the clean-up buffer.
    await db.insert(schema.bookings).values(bookingValues(fixture, TEN_AM));
  });

  afterAll(async () => {
    await fixture?.cleanup();
    await close();
  });

  async function insertAt(minutes: number, overrides = {}) {
    try {
      await db.insert(schema.bookings).values(bookingValues(fixture, at(minutes), overrides));
      return "inserted";
    } catch (error) {
      return pgErrorCode(error);
    }
  }

  it("rejects an overlapping confirmed booking for the same staff member with 23P01", async () => {
    expect(await insertAt(30)).toBe("23P01");
  });

  it("rejects an overlapping pending booking", async () => {
    expect(await insertAt(30, { status: "pending" })).toBe("23P01");
  });

  it("rejects a booking that only overlaps the buffer", async () => {
    // 10:50 starts before the 11:00 end of the first booking's clean-up buffer.
    expect(await insertAt(50)).toBe("23P01");
  });

  it("allows a booking that starts exactly when the buffer ends", async () => {
    expect(await insertAt(60)).toBe("inserted");
  });

  it("ignores cancelled bookings", async () => {
    expect(await insertAt(15, { status: "cancelled" })).toBe("inserted");
  });

  it("allows the same time for a different staff member", async () => {
    const [jonah] = await db
      .insert(schema.staff)
      .values({ businessId: fixture.business.id, name: "Jonah", color: "violet" })
      .returning();
    expect(await insertAt(0, { staffId: jonah!.id })).toBe("inserted");
  });
});

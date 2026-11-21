import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as slotsRoute } from "@/app/api/slots/[slug]/route";
import { zonedInstant } from "@/lib/time-off";
import { bookFromPage } from "@/server/booking/public-booking";
import * as schema from "@/server/db/schema";
import { LIMITS, RATE_LIMIT_MESSAGES } from "@/server/rate-limit";

import { connectTestDb, createFixtureBusiness } from "../support/db";

vi.mock("@/server/email/send", () => ({
  sendEmail: async () => ({ delivered: true }),
  fromAddress: () => "x",
}));

/*
 * The public endpoints under load, with the in-memory limiter (no Upstash
 * keys in tests): slot lookups answer 429 with a message and Retry-After,
 * booking attempts a `rate_limited` result, and other callers carry on.
 */

const MANILA = "Asia/Manila";
const at = (time: string, date = "2026-12-01") => zonedInstant(date, time, MANILA);

describe("rate limits on the public booking endpoints", () => {
  const { db, close } = connectTestDb();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    const businessId = a.business.id;
    await db
      .update(schema.businesses)
      .set({ onboardedAt: new Date(), minNoticeMin: 0 })
      .where(eq(schema.businesses.id, businessId));
    await db
      .insert(schema.staffServices)
      .values({ businessId, staffId: a.staff.id, serviceId: a.service.id });
    await db.insert(schema.availabilityRules).values(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        businessId,
        staffId: a.staff.id,
        weekday,
        startTime: "09:00",
        endTime: "17:00",
      })),
    );
  });

  afterAll(async () => {
    await a?.cleanup();
    await close();
  });

  const lookup = (ip: string) => {
    const search = new URLSearchParams({
      service: a.service.id,
      staff: "any",
      from: at("00:00").toISOString(),
      to: at("00:00", "2026-12-02").toISOString(),
      tz: MANILA,
    });
    return slotsRoute(
      new Request(`http://localhost/api/slots/${a.business.slug}?${search}`, {
        headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
      }),
      { params: Promise.resolve({ slug: a.business.slug }) },
    );
  };

  it("slot lookups: 429 with a message and Retry-After once an IP is over the limit", async () => {
    for (let i = 0; i < LIMITS["slots:ip"].limit; i++) {
      expect((await lookup("203.0.113.10")).status).toBe(200);
    }
    const limited = await lookup("203.0.113.10");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(await limited.json()).toEqual({
      error: "rate_limited",
      message: RATE_LIMIT_MESSAGES["slots:ip"],
    });
    // Another visitor isn't affected.
    expect((await lookup("198.51.100.20")).status).toBe(200);
  });

  it("booking attempts: a friendly refusal after a few, others can still book", async () => {
    const attempt = (ip: string, startsAt?: Date) =>
      bookFromPage({
        slug: a.business.slug,
        ip,
        now: new Date("2026-11-25T00:00:00Z"),
        input: startsAt
          ? {
              serviceId: a.service.id,
              staffId: "any",
              startsAt: startsAt.toISOString(),
              customer: { name: "Rosa", email: `rosa-${Date.now()}@example.com` },
            }
          : { nonsense: true },
      });

    for (let i = 0; i < LIMITS["book:ip"].limit; i++) {
      const result = await attempt("203.0.113.30");
      expect(result.ok || result.error.code).toBe("invalid_input"); // counted all the same
    }
    expect(await attempt("203.0.113.30", at("10:00"))).toEqual({
      ok: false,
      error: { code: "rate_limited", message: RATE_LIMIT_MESSAGES["book:ip"] },
    });
    const elsewhere = await attempt("198.51.100.40", at("10:00"));
    expect(elsewhere.ok).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  NODE_ENV: "test",
  UPSTASH_REDIS_REST_URL: undefined as string | undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined as string | undefined,
}));
vi.mock("@/env", () => ({ env }));

const { LIMITS, RATE_LIMIT_MESSAGES, clientIp, createRateLimit, memoryLimiter } =
  await import("@/server/rate-limit");

/*
 * Public booking endpoints are limited per IP and per business; over the
 * limit, the caller gets a message they can act on and how long to wait.
 */

const T0 = Date.parse("2026-11-21T10:00:00Z");

describe("memoryLimiter", () => {
  it("allows the limit, then refuses until the window resets", async () => {
    const limiter = memoryLimiter();
    const { limit, windowSec } = LIMITS["book:ip"];
    for (let i = 0; i < limit; i++) {
      expect((await limiter.check("book:ip", "1.2.3.4", T0)).success).toBe(true);
    }
    const refused = await limiter.check("book:ip", "1.2.3.4", T0 + 1000);
    expect(refused).toEqual({ success: false, resetAt: T0 + windowSec * 1000 });
    expect((await limiter.check("book:ip", "1.2.3.4", T0 + windowSec * 1000)).success).toBe(true);
  });

  it("counts each key and each limit separately", async () => {
    const limiter = memoryLimiter();
    for (let i = 0; i < LIMITS["book:ip"].limit; i++) await limiter.check("book:ip", "a", T0);
    expect((await limiter.check("book:ip", "a", T0)).success).toBe(false);
    expect((await limiter.check("book:ip", "b", T0)).success).toBe(true);
    expect((await limiter.check("slots:ip", "a", T0)).success).toBe(true);
  });
});

describe("rateLimit", () => {
  const fresh = () => {
    const limiter = memoryLimiter();
    return createRateLimit(() => limiter);
  };

  it("lets a customer book a few times", async () => {
    const rateLimit = fresh();
    for (let i = 0; i < LIMITS["book:ip"].limit; i++) {
      expect(await rateLimit("book", { ip: "1.2.3.4", businessId: "biz" }, T0)).toEqual({
        ok: true,
      });
    }
  });

  it("stops one IP with a friendly message and when to come back", async () => {
    const rateLimit = fresh();
    for (let i = 0; i < LIMITS["book:ip"].limit; i++) {
      await rateLimit("book", { ip: "1.2.3.4", businessId: "biz" }, T0);
    }
    expect(await rateLimit("book", { ip: "1.2.3.4", businessId: "biz" }, T0 + 60_000)).toEqual({
      ok: false,
      limit: "book:ip",
      retryAfterSec: 540,
      message: "That's a lot of booking attempts. Wait a few minutes, then try again.",
    });
    // Someone else can still book.
    expect((await rateLimit("book", { ip: "5.6.7.8", businessId: "biz" }, T0)).ok).toBe(true);
  });

  it("stops a business being flooded from many IPs", async () => {
    const rateLimit = fresh();
    const { limit } = LIMITS["slots:business"];
    for (let i = 0; i < limit; i++) {
      await rateLimit(
        "slots",
        { ip: `10.0.${Math.floor(i / 50)}.${i % 50}`, businessId: "biz" },
        T0,
      );
    }
    const flooded = await rateLimit("slots", { ip: "10.9.9.9", businessId: "biz" }, T0);
    expect(flooded).toMatchObject({ ok: false, limit: "slots:business" });
    expect(flooded.ok || flooded.message).toBe(RATE_LIMIT_MESSAGES["slots:business"]);
    // Another business is unaffected.
    expect((await rateLimit("slots", { ip: "10.9.9.9", businessId: "other" }, T0)).ok).toBe(true);
  });

  it("lets requests through if the store fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rateLimit = createRateLimit(() => ({
      check: () => Promise.reject(new Error("Redis unreachable")),
    }));
    expect(await rateLimit("book", { ip: "1.2.3.4", businessId: "biz" }, T0)).toEqual({ ok: true });
    vi.restoreAllMocks();
  });
});

describe("clientIp", () => {
  it("takes the first forwarded hop, then x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("the shared limiter", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@upstash/ratelimit");
    vi.doUnmock("@upstash/redis");
  });

  it("uses Upstash when its keys are set", async () => {
    vi.resetModules();
    const limit = vi.fn().mockResolvedValue({ success: false, reset: T0 + 30_000 });
    const made: unknown[] = [];
    vi.doMock("@upstash/ratelimit", () => ({
      Ratelimit: Object.assign(
        class {
          limit = limit;
          constructor(options: unknown) {
            made.push(options);
          }
        },
        { slidingWindow: (n: number, w: string) => ({ n, w }) },
      ),
    }));
    vi.doMock("@upstash/redis", () => ({ Redis: class {} }));
    env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    env.UPSTASH_REDIS_REST_TOKEN = "token";
    const { rateLimit } = await import("@/server/rate-limit");
    const result = await rateLimit("slots", { ip: "1.2.3.4", businessId: "biz" }, T0);
    expect(result).toMatchObject({ ok: false, limit: "slots:ip", retryAfterSec: 30 });
    expect(limit).toHaveBeenCalledWith("1.2.3.4");
    expect(made[0]).toMatchObject({
      limiter: { n: 60, w: "60 s" },
      prefix: "slotwren:rl:slots:ip",
    });
    env.UPSTASH_REDIS_REST_URL = undefined;
    env.UPSTASH_REDIS_REST_TOKEN = undefined;
  });
});

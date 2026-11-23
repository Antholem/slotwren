import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { env } from "@/env";

/*
 * Rate limits on the public endpoints: slot lookups, booking attempts and AI
 * chat messages, each counted per IP (one person or bot hammering) and per
 * business (many IPs at one page). Upstash in production; without its keys
 * (local dev) an in-memory counter, per server instance.
 *
 * If the store itself fails we let the request through and log it: a
 * customer who can't book because Redis blinked is worse than a few extra
 * requests.
 */

export const LIMITS = {
  // Flicking through a few weeks of times is ~10 lookups; 60 a minute is generous.
  "slots:ip": { limit: 60, windowSec: 60 },
  "slots:business": { limit: 600, windowSec: 60 },
  // A real customer books once, maybe twice after a "just taken"; 15 leaves
  // room for a family, or a café sharing one IP.
  "book:ip": { limit: 15, windowSec: 600 },
  "book:business": { limit: 60, windowSec: 600 },
  // AI receptionist: each message costs a model call. A person types one every
  // few seconds at most; the per-business cap bounds spend if many IPs pile on.
  "chat:ip": { limit: 20, windowSec: 60 },
  "chat:business": { limit: 300, windowSec: 60 },
} as const;

export type LimitName = keyof typeof LIMITS;
export type Action = "slots" | "book" | "chat";

export type Limiter = {
  check(name: LimitName, key: string, now: number): Promise<{ success: boolean; resetAt: number }>;
};

/** A fixed-window counter in memory: local dev and tests. */
export function memoryLimiter(): Limiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async check(name, key, now) {
      const { limit, windowSec } = LIMITS[name];
      const id = `${name}:${key}`;
      let window = windows.get(id);
      if (!window || window.resetAt <= now) {
        window = { count: 0, resetAt: now + windowSec * 1000 };
        windows.set(id, window);
      }
      window.count++;
      return { success: window.count <= limit, resetAt: window.resetAt };
    },
  };
}

/** Upstash sliding windows, one per limit. */
function upstashLimiter(redis: Redis): Limiter {
  const limiters = new Map<LimitName, Ratelimit>();
  return {
    async check(name, key) {
      let limiter = limiters.get(name);
      if (!limiter) {
        const { limit, windowSec } = LIMITS[name];
        limiter = new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
          prefix: `slotwren:rl:${name}`,
        });
        limiters.set(name, limiter);
      }
      const { success, reset } = await limiter.limit(key);
      return { success, resetAt: reset };
    },
  };
}

let shared: Limiter | null = null;

function defaultLimiter(): Limiter {
  if (shared) return shared;
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    shared = upstashLimiter(
      new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
    );
  } else {
    if (env.NODE_ENV === "production") {
      console.warn("[rate-limit] Upstash not configured; using an in-memory limit per instance.");
    }
    shared = memoryLimiter();
  }
  return shared;
}

export const RATE_LIMIT_MESSAGES = {
  "slots:ip": "You're checking times very quickly. Wait a moment, then try again.",
  "slots:business": "This booking page is very busy right now. Wait a moment, then try again.",
  "book:ip": "That's a lot of booking attempts. Wait a few minutes, then try again.",
  "book:business":
    "This business is taking a lot of bookings right now. Try again in a few minutes.",
  "chat:ip": "You're sending messages very quickly. Wait a moment, then try again.",
  "chat:business": "The assistant is very busy right now. Wait a moment, then try again.",
} as const satisfies Record<LimitName, string>;

export type RateLimitResult =
  { ok: true } | { ok: false; limit: LimitName; retryAfterSec: number; message: string };

/** `rateLimit` bound to a limiter (tests pass their own). */
export function createRateLimit(getLimiter: () => Limiter) {
  return async function rateLimit(
    action: Action,
    { ip, businessId }: { ip: string; businessId: string },
    now = Date.now(),
  ): Promise<RateLimitResult> {
    const checks: [LimitName, string][] = [
      [`${action}:ip`, ip],
      [`${action}:business`, businessId],
    ];
    for (const [name, key] of checks) {
      let result;
      try {
        result = await getLimiter().check(name, key, now);
      } catch (error) {
        console.error("[rate-limit] Check failed; letting the request through", { name, error });
        continue;
      }
      if (!result.success) {
        return {
          ok: false,
          limit: name,
          retryAfterSec: Math.max(1, Math.ceil((result.resetAt - now) / 1000)),
          message: RATE_LIMIT_MESSAGES[name],
        };
      }
    }
    return { ok: true };
  };
}

export const rateLimit = createRateLimit(defaultLimiter);

/**
 * The caller's IP: the first x-forwarded-for hop (set by Vercel), else
 * x-real-ip. Unknown callers share one bucket, which errs on the strict side.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

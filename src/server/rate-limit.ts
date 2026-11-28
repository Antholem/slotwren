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
 * requests. Except the AI limits (`ai:*`): those guard paid model calls, so a
 * failed check refuses (fails closed).
 *
 * Also a shared counter (`adjustCounter`) for the AI token reservations
 * (src/server/ai/guardrails.ts), in the same store.
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
  // A person has one or two chats a day; these stop one IP from spending the
  // shared cap, however it splits its messages into conversations.
  "chat:ip:day": { limit: 40, windowSec: 86_400 },
  "chat:conversations:ip": { limit: 15, windowSec: 86_400 },
  // Every business shares the AI provider's key and its daily quota (env): one
  // count per model call, not per message. One business may use its share of it
  // (AI_BUSINESS_CALL_SHARE, a quarter by default).
  "ai:calls": { limit: env.AI_DAILY_MODEL_CALL_CAP, windowSec: 86_400 },
  "ai:calls:business": {
    limit: Math.max(1, Math.ceil(env.AI_DAILY_MODEL_CALL_CAP * env.AI_BUSINESS_CALL_SHARE)),
    windowSec: 86_400,
  },
  // "Message the team": a person might send one or two; more is spam. Its own
  // bucket per business, so hand-off spam can't use up the booking limits.
  "handoff:business": { limit: 30, windowSec: 600 },
  "handoff:ip": { limit: 3, windowSec: 3_600 },
  // Keyed by email *and* IP: someone else typing a customer's address can't
  // use up that customer's questions.
  "handoff:email": { limit: 3, windowSec: 86_400 },
  "handoff:conversation": { limit: 3, windowSec: 86_400 },
  // The owners' email about a question: a few an hour; the rest wait on the dashboard.
  "handoff:owner-email": { limit: 5, windowSec: 3_600 },
} as const satisfies Record<string, { limit: number; windowSec: number }>;

export type LimitName = keyof typeof LIMITS;
export type Action = "slots" | "book" | "chat";

export type Limiter = {
  check(name: LimitName, key: string, now: number): Promise<{ success: boolean; resetAt: number }>;
  /** Add `delta` to a counter (expiring `ttlSec` after its last change); the new total. */
  adjust(key: string, delta: number, ttlSec: number, now: number): Promise<number>;
};

/** Limits that guard paid AI calls refuse when the store can't be asked. */
const failsClosed = (name: LimitName) => name.startsWith("ai:");

/** A fixed-window counter in memory: local dev and tests. */
export function memoryLimiter(): Limiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  const counters = new Map<string, { value: number; expiresAt: number }>();
  return {
    async adjust(key, delta, ttlSec, now) {
      const current = counters.get(key);
      const value = (current && current.expiresAt > now ? current.value : 0) + delta;
      counters.set(key, { value, expiresAt: now + ttlSec * 1000 });
      return value;
    },
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
    async adjust(key, delta, ttlSec) {
      const id = `slotwren:counter:${key}`;
      const [value] = await redis
        .multi()
        .incrby(id, delta)
        .expire(id, ttlSec)
        .exec<[number, number]>();
      return value;
    },
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

/** Whether limits and counters are shared across server instances (Upstash). */
export function sharedStoreConfigured(): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

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
  "chat:ip:day":
    "You've sent a lot of messages today. You can still book on this page, or chat again tomorrow.",
  "chat:conversations:ip":
    "You've started a lot of chats today. You can still book on this page, or chat again tomorrow.",
  "ai:calls": "The assistant isn't available right now. You can still book on this page.",
  "ai:calls:business": "The assistant isn't available right now. You can still book on this page.",
  "handoff:business":
    "The team is getting a lot of questions right now. Try again in a few minutes.",
  "handoff:ip": "You've sent a few questions already. Try again in an hour.",
  "handoff:email":
    "You've sent a few questions today. The team will reply by email; try again tomorrow.",
  "handoff:conversation":
    "You've sent a few questions from this chat. The team will reply by email.",
  "handoff:owner-email": "The team has been told about a few questions already.",
} as const satisfies Record<LimitName, string>;

export type RateLimitResult =
  { ok: true } | { ok: false; limit: LimitName; retryAfterSec: number; message: string };

/** Every check in order; the first one over its limit refuses. Tests pass their own limiter. */
export function createLimitAll(getLimiter: () => Limiter) {
  return async function limitAll(
    checks: [LimitName, string][],
    now = Date.now(),
  ): Promise<RateLimitResult> {
    for (const [name, key] of checks) {
      let result;
      try {
        result = await getLimiter().check(name, key, now);
      } catch (error) {
        const closed = failsClosed(name);
        console.error(
          closed
            ? "[rate-limit] Check failed; refusing (AI limit)"
            : "[rate-limit] Check failed; letting the request through",
          { name, error: error instanceof Error ? error.name : "Unknown" },
        );
        if (!closed) continue;
        return { ok: false, limit: name, retryAfterSec: 60, message: RATE_LIMIT_MESSAGES[name] };
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

/** `rateLimit` bound to a limiter (tests pass their own). */
export function createRateLimit(getLimiter: () => Limiter) {
  const limitAll = createLimitAll(getLimiter);
  return async function rateLimit(
    action: Action,
    { ip, businessId }: { ip: string; businessId: string },
    now = Date.now(),
  ): Promise<RateLimitResult> {
    return limitAll(
      [
        [`${action}:ip`, ip],
        [`${action}:business`, businessId],
      ],
      now,
    );
  };
}

export const rateLimit = createRateLimit(defaultLimiter);

/** Any limits, by name and key (the daily AI cap, hand-off spam). */
export const limitAll = createLimitAll(defaultLimiter);

/**
 * Add to a shared counter (the AI token reservations); the new total. Throws
 * when the store fails: callers guarding paid calls refuse then.
 */
export function adjustCounter(key: string, delta: number, ttlSec: number, now = Date.now()) {
  return defaultLimiter().adjust(key, delta, ttlSec, now);
}

/**
 * The caller's IP: the first x-forwarded-for hop (set by Vercel), else
 * x-real-ip. Unknown callers share one bucket, which errs on the strict side.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

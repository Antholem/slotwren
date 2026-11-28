import { z } from "zod";

/**
 * Validated environment. Import `env` (server) or `clientEnv` (anywhere) instead
 * of reading process.env directly.
 *
 * Keys for features that aren't built yet (AI, email, billing, jobs, rate
 * limiting) are optional everywhere until REQUIRE_FEATURE_KEYS=true, which is
 * set on Vercel Production at launch (Phase 5). From then on a misconfigured
 * deploy fails at build instead of at the first booking. It's opt-in because
 * Vercel builds main as Production long before every key exists.
 */

const requireFeatureKeys = process.env.REQUIRE_FEATURE_KEYS === "true";

/** Optional until REQUIRE_FEATURE_KEYS=true. */
const featureKey = () => (requireFeatureKeys ? z.string().min(1) : z.string().min(1).optional());

/**
 * Without an explicit NEXT_PUBLIC_APP_URL, Vercel deploys use their own URL
 * (Vercel exposes NEXT_PUBLIC_VERCEL_* to Next.js automatically), so preview
 * links in emails and manage pages point at the preview, not localhost.
 */
function defaultAppUrl() {
  const host =
    process.env.NEXT_PUBLIC_VERCEL_ENV === "production"
      ? process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
      : (process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL ?? process.env.NEXT_PUBLIC_VERCEL_URL);
  return host ? `https://${host}` : "http://localhost:3000";
}

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
});

const serverSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // Database: direct Postgres connection used by Drizzle
    DATABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(1),

    // AI receptionist. AI_MODEL defaults per provider (src/server/ai/model.ts).
    // "mock": a scripted, keyless model for Playwright and local UI work;
    // refused on Vercel Production below.
    AI_PROVIDER: z.enum(["gemini", "anthropic", "mock"]).default("gemini"),
    AI_MODEL: z.string().min(1).max(100).optional(),
    // Model calls a day across every business (each customer message is 1–5): keeps
    // one busy business (or an attacker) from spending the shared key's quota. 450
    // leaves room under Gemini Flash-Lite's ~500 a day for the SDK's one retry.
    AI_DAILY_MODEL_CALL_CAP: z.coerce.number().int().min(1).max(1_000_000).default(450),
    // The share of that cap one business may use a day (0–1], so one busy (or
    // attacked) business can't switch the AI off for everyone.
    AI_BUSINESS_CALL_SHARE: z.coerce.number().gt(0).max(1).default(0.25),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),

    // Email
    RESEND_API_KEY: featureKey(),
    EMAIL_FROM: z.string().min(1).default("Slotwren <bookings@slotwren.com>"),

    // Billing
    STRIPE_SECRET_KEY: featureKey(),
    STRIPE_WEBHOOK_SECRET: featureKey(),
    STRIPE_PRO_PRICE_ID: featureKey(),

    // Background jobs (the local Inngest dev server needs no keys)
    INNGEST_EVENT_KEY: featureKey(),
    INNGEST_SIGNING_KEY: featureKey(),
    // "1" locally: talk to the Inngest dev server (pnpm jobs:dev), no keys needed.
    INNGEST_DEV: z.enum(["0", "1"]).optional(),
    // Set by Vercel on every deploy.
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),

    // Rate limiting
    UPSTASH_REDIS_REST_URL: requireFeatureKeys ? z.url() : z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: featureKey(),

    // Monitoring
    SENTRY_DSN: z.url().optional(),
    SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    // Dev mode skips request signing: never on production, whatever leaked into its env.
    if (env.INNGEST_DEV === "1" && env.VERCEL_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["INNGEST_DEV"],
        message: "Must not be 1 in production (it turns off request signing)",
      });
    }
    // The mock model answers from a script: never for real customers.
    if (env.AI_PROVIDER === "mock" && env.VERCEL_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["AI_PROVIDER"],
        message: "Must not be mock in production",
      });
      return;
    }
    if (env.AI_PROVIDER === "mock") return;
    const keyFor = {
      gemini: "GOOGLE_GENERATIVE_AI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
    } as const;
    const key = keyFor[env.AI_PROVIDER];
    if (requireFeatureKeys && !env[key]) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `Required when AI_PROVIDER=${env.AI_PROVIDER}`,
      });
    }
  });

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

// Skip in CI lint/typecheck steps that import modules without a real environment.
const skipValidation = process.env.SKIP_ENV_VALIDATION === "true";

function parse<T extends z.ZodType>(schema: T, values: Record<string, unknown>): z.infer<T> {
  if (skipValidation) return values as z.infer<T>;
  // `KEY=` in a .env file means "not set", not "set to empty".
  const cleaned = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value === "" ? undefined : value]),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}\nSee .env.example.`);
  }
  return result.data;
}

// NEXT_PUBLIC_* must be referenced by full name so Next inlines them into the client bundle.
export const clientEnv: ClientEnv = parse(clientSchema, {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || defaultAppUrl(),
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});

const isServer = typeof window === "undefined";

/**
 * Server-only variables. Reading this in the browser throws, so a secret can't
 * leak through a client component by accident.
 */
export const env: ServerEnv & ClientEnv = isServer
  ? { ...parse(serverSchema, process.env), ...clientEnv }
  : new Proxy({} as ServerEnv & ClientEnv, {
      get(_, prop) {
        if (typeof prop === "string" && prop in clientEnv) {
          return clientEnv[prop as keyof ClientEnv];
        }
        throw new Error(`Server env "${String(prop)}" was read in the browser.`);
      },
    });

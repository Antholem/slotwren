import { z } from "zod";

/**
 * Validated environment. Import `env` (server) or `clientEnv` (anywhere) instead
 * of reading process.env directly.
 *
 * Keys for features that aren't built yet are optional in development and
 * required on a production deploy (VERCEL_ENV=production), so a misconfigured
 * deploy fails at boot instead of at the first booking.
 */

const isProductionDeploy = process.env.VERCEL_ENV === "production";

/** Optional locally, required in production. */
const prodRequired = () => (isProductionDeploy ? z.string().min(1) : z.string().min(1).optional());

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
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

    // AI receptionist
    AI_PROVIDER: z.enum(["gemini", "anthropic"]).default("gemini"),
    AI_MODEL: prodRequired(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),

    // Email
    RESEND_API_KEY: prodRequired(),
    EMAIL_FROM: z.string().min(1).default("Slotwren <bookings@slotwren.com>"),

    // Billing
    STRIPE_SECRET_KEY: prodRequired(),
    STRIPE_WEBHOOK_SECRET: prodRequired(),
    STRIPE_PRO_PRICE_ID: prodRequired(),

    // Background jobs (the local Inngest dev server needs no keys)
    INNGEST_EVENT_KEY: prodRequired(),
    INNGEST_SIGNING_KEY: prodRequired(),

    // Rate limiting
    UPSTASH_REDIS_REST_URL: isProductionDeploy ? z.url() : z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: prodRequired(),

    // Monitoring
    SENTRY_DSN: z.url().optional(),
    SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    const keyFor = {
      gemini: "GOOGLE_GENERATIVE_AI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
    } as const;
    const key = keyFor[env.AI_PROVIDER];
    if (isProductionDeploy && !env[key]) {
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
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
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

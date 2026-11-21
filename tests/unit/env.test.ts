import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * The environment is validated once, at import: a misconfigured deploy fails
 * at build, not at the first booking.
 */

const valid = {
  SKIP_ENV_VALIDATION: "false",
  REQUIRE_FEATURE_KEYS: "false",
  NEXT_PUBLIC_APP_URL: "https://slotwren.example",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:54322/postgres",
  SUPABASE_SECRET_KEY: "sb_secret_test",
};

async function loadEnv(overrides: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...valid, ...overrides })) vi.stubEnv(key, value);
  return import("@/env");
}

describe("env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("loads a valid environment", async () => {
    const { env } = await loadEnv({ INNGEST_DEV: "1", VERCEL_ENV: "preview" });
    expect(env.INNGEST_DEV).toBe("1");
  });

  it("refuses the Inngest dev server on production, where it would skip signing", async () => {
    await expect(loadEnv({ INNGEST_DEV: "1", VERCEL_ENV: "production" })).rejects.toThrow(
      /INNGEST_DEV: Must not be 1 in production/,
    );
    const { env } = await loadEnv({ INNGEST_DEV: "0", VERCEL_ENV: "production" });
    expect(env.VERCEL_ENV).toBe("production");
  });
});

import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Same .env.local loading rules as Next.js.
loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  // Supabase CLI applies these (`supabase db reset` / `supabase db push`).
  out: "./supabase/migrations",
  migrations: { prefix: "supabase" },
  // auth.*, storage.* etc. belong to Supabase.
  schemaFilter: ["public"],
  entities: { roles: { provider: "supabase" } },
  dbCredentials: { url },
  strict: true,
  verbose: true,
});

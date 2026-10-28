import "server-only";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/env";

import * as schema from "./schema";

/*
 * Two ways into the database (see docs/proposal-foundation.md §3–4):
 *
 * - withRls(claims, fn): dashboard reads/writes as the signed-in user. Runs as
 *   the `authenticated` role, so Postgres RLS applies on top of the explicit
 *   business_id filters in src/server/db/queries.
 * - adminDb: bypasses RLS. Only for paths without a signed-in user (public
 *   booking page, manage links, AI chat, webhooks, jobs, seed). Every query
 *   function built on it must take a businessId argument and select only the
 *   fields that path needs.
 */

function createClient() {
  // prepare: false keeps it compatible with Supabase's transaction pooler.
  const connection = postgres(env.DATABASE_URL, { prepare: false });
  return drizzle(connection, { schema });
}

export type Database = ReturnType<typeof createClient>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { slotwrenDb?: Database };
export const adminDb: Database = globalForDb.slotwrenDb ?? createClient();
if (env.NODE_ENV !== "production") globalForDb.slotwrenDb = adminDb;

/** The parts of the Supabase JWT our RLS policies read. */
export type RlsClaims = { sub: string; email?: string };

/**
 * Run `fn` in a transaction as the `authenticated` role with the user's JWT
 * claims set, so auth.uid() and every RLS policy apply.
 */
export async function withRls<T>(
  claims: RlsClaims,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return adminDb.transaction(async (tx) => {
    const jwtClaims = JSON.stringify({ ...claims, role: "authenticated" });
    await tx.execute(sql`select set_config('request.jwt.claims', ${jwtClaims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

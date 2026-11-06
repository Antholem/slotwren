import "server-only";

import { adminDb, type Database } from "./client";

/*
 * The only way to use adminDb (RLS bypassed). ESLint allows importing this
 * module from src/server/db/queries/public/ (booking page, embed, manage links,
 * AI chat) and src/server/db/queries/system/ (webhooks, jobs) only. Dashboard
 * queries use withRls.
 */

/** Arguments every tenant-scoped admin query must take. */
export type TenantScoped = { businessId: string };

/**
 * Define an adminDb query. The type parameter forces `businessId` into its
 * arguments, so no admin query can exist without one; the function body must
 * still filter by it.
 *
 * @example
 * export const getPublicServices = adminQuery(async (db, { businessId }: TenantScoped) =>
 *   db.select({ id: services.id, name: services.name }).from(services)
 *     .where(eq(services.businessId, businessId)),
 * );
 */
export function adminQuery<Args extends TenantScoped, Result>(
  run: (db: Database, args: Args) => Promise<Result>,
): (args: Args) => Promise<Result> {
  return (args) => run(adminDb, args);
}

/**
 * The lookups that *resolve* a tenant, so they can't take a businessId yet.
 * Each returns the business ID plus public fields only (invite: the accept page
 * preview). Adding a kind here is a
 * deliberate, reviewable change.
 */
export type TenantLookupKind =
  "bySlug" | "byManageTokenHash" | "byInviteTokenHash" | "byStripeCustomerId";

export function tenantLookup<Args, Result>(
  _kind: TenantLookupKind,
  run: (db: Database, args: Args) => Promise<Result>,
): (args: Args) => Promise<Result> {
  return (args) => run(adminDb, args);
}

import "server-only";

import { eq } from "drizzle-orm";

import { type RlsClaims, withRls } from "../client";
import { memberships } from "../schema";

/**
 * Whether the signed-in user belongs to at least one business. Scoped by
 * user_id (memberships are how a user finds their tenants) and by RLS.
 */
export async function hasAnyMembership(claims: RlsClaims): Promise<boolean> {
  const rows = await withRls(claims, (tx) =>
    tx
      .select({ businessId: memberships.businessId })
      .from(memberships)
      .where(eq(memberships.userId, claims.sub))
      .limit(1),
  );
  return rows.length > 0;
}

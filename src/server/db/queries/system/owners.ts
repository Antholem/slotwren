import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";

import { adminQuery, type TenantScoped } from "../../admin";
import { memberships } from "../../schema";

/**
 * Where "new booking" emails go: the sign-in addresses of the business's
 * owners. Server only (booking notifications); never shown to anyone else.
 */
export const getOwnerEmails = adminQuery(
  async (db, { businessId }: TenantScoped): Promise<string[]> => {
    const rows = await db
      .select({ email: authUsers.email })
      .from(memberships)
      .innerJoin(authUsers, eq(authUsers.id, memberships.userId))
      .where(
        and(
          eq(memberships.businessId, businessId),
          eq(memberships.role, "owner"),
          isNotNull(authUsers.email),
        ),
      );
    return rows.map((row) => row.email!).filter(Boolean);
  },
);

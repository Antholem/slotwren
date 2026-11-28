import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";

import { adminQuery, type TenantScoped } from "../../admin";
import { businesses, memberships } from "../../schema";

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

/** What an email to the owners shows of their business: name, brand and its timezone. */
export const getEmailBusiness = adminQuery(
  async (
    db,
    { businessId }: TenantScoped,
  ): Promise<{
    name: string;
    brandColor: string;
    address: string | null;
    logoUrl: string | null;
    timezone: string;
  } | null> => {
    const [row] = await db
      .select({
        name: businesses.name,
        brandColor: businesses.brandColor,
        address: businesses.address,
        logoUrl: businesses.logoUrl,
        timezone: businesses.timezone,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    return row ?? null;
  },
);

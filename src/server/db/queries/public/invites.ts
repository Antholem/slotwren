import "server-only";

import { eq } from "drizzle-orm";

import { tenantLookup } from "../../admin";
import { businesses, staff, staffInvites } from "../../schema";

/** What the accept page may show anyone holding an invite link. */
export type PublicInvitePreview = {
  businessId: string;
  businessName: string;
  logoUrl: string | null;
  inviteeName: string;
  /** "s••@example.com": enough to spot the right account, not to harvest. */
  emailHint: string;
  status: "pending" | "accepted" | "expired";
  expiresAt: Date;
};

/** "sam@example.com" → "s••@example.com". */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}••@${domain}`;
}

/**
 * Resolve an invite from its token hash (the accept page runs before the
 * visitor is a member, so it can't use withRls). Selects explicit public
 * fields only: never the token hash, the raw email or anything internal.
 */
export const getInvitePreview = tenantLookup(
  "byInviteTokenHash",
  async (db, { tokenHash, now }: { tokenHash: string; now: Date }) => {
    const [row] = await db
      .select({
        businessId: businesses.id,
        businessName: businesses.name,
        logoUrl: businesses.logoUrl,
        inviteeName: staff.name,
        email: staffInvites.email,
        expiresAt: staffInvites.expiresAt,
        acceptedAt: staffInvites.acceptedAt,
      })
      .from(staffInvites)
      .innerJoin(businesses, eq(businesses.id, staffInvites.businessId))
      .innerJoin(staff, eq(staff.id, staffInvites.staffId))
      .where(eq(staffInvites.tokenHash, tokenHash))
      .limit(1);
    if (!row) return null;

    const { email, acceptedAt, ...rest } = row;
    const preview: PublicInvitePreview = {
      ...rest,
      emailHint: maskEmail(email),
      status: acceptedAt ? "accepted" : row.expiresAt <= now ? "expired" : "pending",
    };
    return preview;
  },
);

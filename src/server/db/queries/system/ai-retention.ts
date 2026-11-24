import "server-only";

import { and, eq, lt } from "drizzle-orm";

import { adminQuery, type TenantScoped, tenantLookup } from "../../admin";
import { aiConversations } from "../../schema";

/*
 * Transcript retention (the daily job in src/server/jobs/functions.ts):
 * conversations whose last message is older than the cutoff are deleted with
 * their messages and proposals (ON DELETE CASCADE). Bookings, customers and
 * questions for the team stay; their link to the chat is set to null.
 */

/** Businesses with at least one conversation last active before `before`. */
export const businessesWithExpiredTranscripts = tenantLookup(
  "withExpiredTranscripts",
  async (db, { before, limit }: { before: Date; limit: number }): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ businessId: aiConversations.businessId })
      .from(aiConversations)
      .where(lt(aiConversations.lastMessageAt, before))
      .limit(limit);
    return rows.map((r) => r.businessId);
  },
);

/** Delete one business's conversations last active before `before`; returns how many. */
export const deleteExpiredTranscripts = adminQuery(
  async (db, { businessId, before }: TenantScoped & { before: Date }): Promise<number> => {
    const rows = await db
      .delete(aiConversations)
      .where(
        and(eq(aiConversations.businessId, businessId), lt(aiConversations.lastMessageAt, before)),
      )
      .returning({ id: aiConversations.id });
    return rows.length;
  },
);

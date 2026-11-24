import "server-only";

import { TRANSCRIPT_RETENTION_DAYS } from "@/lib/ai-transcripts";
import {
  businessesWithExpiredTranscripts,
  deleteExpiredTranscripts,
} from "@/server/db/queries/system/ai-retention";

/*
 * AI transcripts are kept for TRANSCRIPT_RETENTION_DAYS (90) after their last
 * message, then deleted, one business at a time. Bookings and customers made
 * in the chat stay. Run daily by the Inngest job "ai-transcript-retention".
 */

export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - TRANSCRIPT_RETENTION_DAYS * 86_400_000);
}

export async function purgeExpiredTranscripts(
  now = new Date(),
  { batch = 200 }: { batch?: number } = {},
): Promise<{ businesses: number; deleted: number }> {
  const before = retentionCutoff(now);
  let businesses = 0;
  let deleted = 0;
  // Batches of businesses until none have anything left to delete.
  for (;;) {
    const ids = await businessesWithExpiredTranscripts({ before, limit: batch });
    if (ids.length === 0) break;
    for (const businessId of ids) {
      deleted += await deleteExpiredTranscripts({ businessId, before });
      businesses++;
    }
    if (ids.length < batch) break;
  }
  return { businesses, deleted };
}

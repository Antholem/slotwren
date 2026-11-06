import "server-only";

import { env } from "@/env";
import { createSupabaseServerClient } from "@/server/supabase/server";

/*
 * Business logos live in the public "logos" bucket at <business_id>/<file>.
 * Shared by onboarding's brand step and Settings → Business.
 */

/** Only logos uploaded to this business's folder in our bucket. */
export function isOwnLogoUrl(businessId: string, url: string): boolean {
  const prefix = new URL(
    `/storage/v1/object/public/logos/${businessId}/`,
    env.NEXT_PUBLIC_SUPABASE_URL,
  ).toString();
  return url.startsWith(prefix);
}

/**
 * Delete earlier uploads (replaced or removed logos) from the business's
 * folder, as the owner so Storage RLS applies. Best effort: a leftover file
 * costs a few KB, so failures are logged, not shown.
 */
export async function removeUnusedLogos(businessId: string, keepUrl: string | null) {
  const supabase = await createSupabaseServerClient();
  const bucket = supabase.storage.from("logos");
  const { data: files, error } = await bucket.list(businessId);
  if (error) {
    console.error("Listing logos failed", { businessId, message: error.message });
    return;
  }
  const keep = keepUrl
    ? decodeURIComponent(new URL(keepUrl).pathname.split("/").pop() ?? "")
    : null;
  const stale = files
    .filter((file) => file.name !== keep)
    .map((file) => `${businessId}/${file.name}`);
  if (stale.length === 0) return;
  const { error: removeError } = await bucket.remove(stale);
  if (removeError) {
    console.error("Removing old logos failed", { businessId, message: removeError.message });
  }
}

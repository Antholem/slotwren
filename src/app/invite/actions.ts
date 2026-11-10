"use server";

import { redirect } from "next/navigation";

import { err, type Result } from "@/lib/result";
import { setCurrentBusiness } from "@/server/auth/dashboard";
import { getCurrentUser, rlsClaimsFor } from "@/server/auth/session";
import { acceptMyInvite } from "@/server/catalog/staff";

/** Accept an invite sent to the signed-in user's email, then open that business. */
export async function acceptMyInviteAction(inviteId: unknown): Promise<Result<never>> {
  const user = await getCurrentUser();
  if (!user) return err("not_signed_in", "Sign in to accept this invite.");

  const result = await acceptMyInvite(rlsClaimsFor(user), inviteId);
  if (!result.ok) return result;

  await setCurrentBusiness(result.data.businessId);
  redirect("/app");
}

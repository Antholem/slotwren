"use server";

import { redirect } from "next/navigation";

import { err, type Result } from "@/lib/result";
import { setCurrentBusiness } from "@/server/auth/dashboard";
import { getCurrentUser, rlsClaimsFor } from "@/server/auth/session";
import { acceptInvite } from "@/server/catalog/staff";

/** Accept, switch the dashboard to that business, and go there. */
export async function acceptInviteAction(token: unknown): Promise<Result<never>> {
  const user = await getCurrentUser();
  if (!user) return err("not_signed_in", "Sign in to accept this invite.");

  const result = await acceptInvite(rlsClaimsFor(user), token);
  if (!result.ok) return result;

  await setCurrentBusiness(result.data.businessId);
  redirect("/app");
}

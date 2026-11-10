import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { StepSkeleton } from "@/components/onboarding/step-shell";
import { requireUser, rlsClaimsFor } from "@/server/auth/session";
import { getAccountStatus, getSetupState } from "@/server/db/queries/onboarding";
import { listMyPendingInvites } from "@/server/db/queries/staff";

import { resumePath } from "./load-step";

export const metadata: Metadata = {
  title: "Set up your business",
};

/** /onboarding: pick up the wizard where the owner left off. */
export default function OnboardingPage() {
  return (
    <Suspense fallback={<StepSkeleton />}>
      <Resume />
    </Suspense>
  );
}

async function Resume(): Promise<never> {
  const claims = rlsClaimsFor(await requireUser());
  const state = await getSetupState(claims);
  if (!state) {
    const status = await getAccountStatus(claims);
    if (status === "ready") redirect("/app");
    // A new user someone invited (who may have lost the invite link by
    // signing in on another device) joins that team before starting a business.
    if (status === "none" && (await listMyPendingInvites(claims)).length > 0) {
      redirect("/invite");
    }
  }
  redirect(resumePath(state));
}

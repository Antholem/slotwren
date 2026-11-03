import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { StepSkeleton } from "@/components/onboarding/step-shell";
import { requireUser, rlsClaimsFor } from "@/server/auth/session";
import { getAccountStatus, getSetupState } from "@/server/db/queries/onboarding";

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
  if (!state && (await getAccountStatus(claims)) === "ready") redirect("/app");
  redirect(resumePath(state));
}

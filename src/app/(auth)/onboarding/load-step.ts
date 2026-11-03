import "server-only";

import type { Route } from "next";
import { redirect } from "next/navigation";

import type { PreviewProps } from "@/components/onboarding/booking-preview";
import { env } from "@/env";
import { DEFAULT_BRAND_COLOR } from "@/lib/color";
import { fromAvailabilityRows, openingSummary } from "@/lib/hours";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/validation/onboarding";
import { requireUser, rlsClaimsFor } from "@/server/auth/session";
import { getAccountStatus, getSetupState, type SetupState } from "@/server/db/queries/onboarding";

/** Where an owner continues: the first step they haven't finished. */
export function resumePath(state: SetupState | null): Route {
  if (!state) return "/onboarding/basics";
  if (state.business.onboardedAt) return "/onboarding/live";
  return ONBOARDING_STEPS[Math.min(state.business.setupStep, 3)]!.path;
}

/** Host shown in booking links: "slotwren.com", "localhost:3000". */
export const bookingHost = () => new URL(env.NEXT_PUBLIC_APP_URL).host;

/**
 * Load a wizard step for the signed-in owner, redirecting when they can't be
 * there: owners with a live business (and nothing in progress) go to the
 * dashboard, and nobody skips ahead of the steps they've finished.
 */
export async function loadStep(step: OnboardingStep) {
  const user = await requireUser();
  const claims = rlsClaimsFor(user);
  const state = await getSetupState(claims);

  if (!state) {
    if ((await getAccountStatus(claims)) === "ready") redirect("/app");
    if (step > 1) redirect("/onboarding/basics");
  } else if (step > state.business.setupStep + 1) {
    redirect(resumePath(state));
  }

  return { user, state };
}

/** Everything the live preview shows that the current step doesn't edit. */
export function previewFrom(state: SetupState | null): PreviewProps {
  const business = state?.business;
  return {
    host: bookingHost(),
    slug: business?.slug ?? "",
    name: business?.name ?? "",
    brandColor: business?.brandColor ?? DEFAULT_BRAND_COLOR,
    logoUrl: business?.logoUrl ?? null,
    currency: business?.currency ?? "USD",
    hoursLabel: openingSummary(fromAvailabilityRows(state?.hours ?? [])),
    service: state?.service ?? null,
  };
}

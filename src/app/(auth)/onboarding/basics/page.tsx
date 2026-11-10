import type { Metadata } from "next";
import { Suspense } from "react";

import { OnboardingTopBar } from "@/components/onboarding/onboarding-top-bar";
import { StepSkeleton } from "@/components/onboarding/step-shell";
import { listTimeZones, timeZoneLabel } from "@/lib/timezones";
import { rlsClaimsFor } from "@/server/auth/session";
import { getProfileName } from "@/server/db/queries/onboarding";

import { loadStep, previewFrom } from "../load-step";
import { BasicsForm } from "./basics-form";

export const metadata: Metadata = { title: "Business basics" };

export default function BasicsPage() {
  return (
    <>
      <OnboardingTopBar variant="steps" />
      <Suspense fallback={<StepSkeleton />}>
        <Basics />
      </Suspense>
    </>
  );
}

async function Basics() {
  const { user, state } = await loadStep(1);
  const business = state?.business;
  // Their name on this business, else from Google (via their profile).
  const ownerName = state?.ownerName ?? (await getProfileName(rlsClaimsFor(user))) ?? "";
  return (
    <BasicsForm
      // Labelled once on the server: Node and browsers format offsets differently.
      timeZones={listTimeZones().map((zone) => ({ value: zone, label: timeZoneLabel(zone) }))}
      ownerName={ownerName}
      initial={
        business
          ? { ownerName, name: business.name, slug: business.slug, timezone: business.timezone }
          : null
      }
      preview={previewFrom(state)}
    />
  );
}

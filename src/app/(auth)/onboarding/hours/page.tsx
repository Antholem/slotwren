import type { Metadata } from "next";
import { Suspense } from "react";

import { OnboardingTopBar } from "@/components/onboarding/onboarding-top-bar";
import { StepSkeleton } from "@/components/onboarding/step-shell";
import { fromAvailabilityRows } from "@/lib/hours";

import { loadStep, previewFrom } from "../load-step";
import { HoursForm } from "./hours-form";

export const metadata: Metadata = { title: "Working hours" };

export default function HoursPage() {
  return (
    <>
      <OnboardingTopBar variant="steps" />
      <Suspense fallback={<StepSkeleton />}>
        <Hours />
      </Suspense>
    </>
  );
}

async function Hours() {
  const { state } = await loadStep(4);
  return (
    <HoursForm
      initial={{ days: fromAvailabilityRows(state!.hours) }}
      preview={previewFrom(state)}
    />
  );
}

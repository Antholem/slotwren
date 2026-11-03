import type { Metadata } from "next";
import { Suspense } from "react";

import { OnboardingTopBar } from "@/components/onboarding/onboarding-top-bar";
import { StepSkeleton } from "@/components/onboarding/step-shell";

import { loadStep, previewFrom } from "../load-step";
import { BrandForm } from "./brand-form";

export const metadata: Metadata = { title: "Brand" };

export default function BrandPage() {
  return (
    <>
      <OnboardingTopBar variant="steps" />
      <Suspense fallback={<StepSkeleton />}>
        <Brand />
      </Suspense>
    </>
  );
}

async function Brand() {
  const { state } = await loadStep(2);
  const business = state!.business;
  return (
    <BrandForm
      businessId={business.id}
      initial={{ brandColor: business.brandColor, logoUrl: business.logoUrl }}
      preview={previewFrom(state)}
    />
  );
}

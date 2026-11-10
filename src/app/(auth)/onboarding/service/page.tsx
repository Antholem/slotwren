import type { Metadata } from "next";
import { Suspense } from "react";

import { OnboardingTopBar } from "@/components/onboarding/onboarding-top-bar";
import { StepSkeleton } from "@/components/onboarding/step-shell";
import { centsToInput, currencySymbol } from "@/lib/money";

import { loadStep, previewFrom } from "../load-step";
import { ServiceForm } from "./service-form";

export const metadata: Metadata = { title: "First service" };

export default function ServicePage() {
  return (
    <>
      <OnboardingTopBar variant="steps" />
      <Suspense fallback={<StepSkeleton />}>
        <Service />
      </Suspense>
    </>
  );
}

async function Service() {
  const { state } = await loadStep(3);
  const service = state!.service;
  return (
    <ServiceForm
      currency={state!.business.currency}
      currencySymbol={currencySymbol(state!.business.currency)}
      initial={
        service
          ? {
              name: service.name,
              durationMin: service.durationMin,
              price: centsToInput(service.priceCents, state!.business.currency),
              bufferAfterMin: service.bufferAfterMin,
              description: service.description ?? "",
            }
          : { name: "", durationMin: 45, price: "", bufferAfterMin: 0, description: "" }
      }
      preview={previewFrom(state)}
    />
  );
}

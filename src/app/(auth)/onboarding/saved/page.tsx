import { CircleCheck, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { OnboardingTopBar } from "@/components/onboarding/onboarding-top-bar";
import { Button } from "@/components/ui/button";
import { ONBOARDING_STEPS } from "@/lib/validation/onboarding";
import { requireUser, rlsClaimsFor } from "@/server/auth/session";
import { getAccountStatus, getSetupState } from "@/server/db/queries/onboarding";

export const metadata: Metadata = { title: "Setup saved" };

/** Where "Save and finish later" lands. The owner stays signed in. */
export default function SetupSavedPage() {
  return (
    <>
      <OnboardingTopBar variant="plain" />
      <main className="flex flex-1 items-start justify-center bg-background px-4 py-12 sm:py-20">
        <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center shadow-xs">
          <Suspense fallback={<SavedSkeleton />}>
            <SavedDetails />
          </Suspense>
          <div className="mt-2 flex w-full flex-col items-center gap-2">
            <Button asChild className="h-11 w-full px-6 text-label sm:w-auto">
              <Link href="/onboarding">Continue setup</Link>
            </Button>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="min-h-11 rounded-md px-3 text-label text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </main>
    </>
  );
}

async function SavedDetails() {
  const claims = rlsClaimsFor(await requireUser());
  const state = await getSetupState(claims);

  if (!state) {
    // Live owners have nothing to finish.
    if ((await getAccountStatus(claims)) === "ready") redirect("/app");
    // Left step 1 before saving it: be honest that there's nothing to keep.
    return (
      <>
        <span className="flex size-14 items-center justify-center rounded-full bg-info-soft text-info-text">
          <Info aria-hidden className="size-7" />
        </span>
        <h1 className="text-heading">Nothing saved yet</h1>
        <p className="text-body text-muted-foreground">
          Your business is saved once you finish the first step, business basics. It takes about a
          minute.
        </p>
      </>
    );
  }

  const next = ONBOARDING_STEPS[Math.min(state.business.setupStep, 3)]!;
  return (
    <>
      <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success-text">
        <CircleCheck aria-hidden className="size-7" />
      </span>
      <h1 className="text-heading">Setup saved</h1>
      <p className="text-body text-muted-foreground">
        Your progress on <span className="font-medium text-foreground">{state.business.name}</span>{" "}
        is saved. Pick up any time: you&rsquo;ll go straight back to{" "}
        <span className="font-medium text-foreground">{next.label.toLowerCase()}</span>.
      </p>
    </>
  );
}

function SavedSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex w-full flex-col items-center gap-4">
      <div className="size-14 animate-pulse rounded-full bg-muted" />
      <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      <div className="h-12 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}

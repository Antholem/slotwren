import type { Metadata } from "next";
import { Suspense } from "react";

import { SignedInTopBar } from "@/components/shared/top-bar";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Set up your business",
};

// Placeholder: the onboarding wizard replaces the card body in Phase 1, step 2.
export default function OnboardingPage() {
  return (
    <>
      <SignedInTopBar />
      <main className="flex flex-1 justify-center bg-background px-4 py-12">
        <div className="w-full max-w-2xl rounded-xl border bg-card p-6 shadow-sm sm:p-10">
          <h1 className="text-heading sm:text-display">Let&rsquo;s set up your business</h1>
          <Suspense fallback={<div className="mt-2 h-5 w-64 animate-pulse rounded bg-muted" />}>
            <SignedInAs />
          </Suspense>
        </div>
      </main>
    </>
  );
}

async function SignedInAs() {
  const user = await requireUser();
  return (
    <p className="mt-2 text-body text-muted-foreground">
      Signed in as <span className="font-medium text-foreground">{user.email}</span>. Next
      you&rsquo;ll add your business name, booking link, brand, first service and hours.
    </p>
  );
}

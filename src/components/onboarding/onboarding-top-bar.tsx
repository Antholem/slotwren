import Link from "next/link";

import { Logo } from "@/components/shared/logo";
import { SignOutButton } from "@/components/shared/sign-out-button";

import { STEP_FORM_ID } from "./step-shell";

/**
 * Wizard steps: "Save and finish later" submits the current step's form with
 * intent=later (save if valid, then sign out). The "You're live" page offers
 * the dashboard and sign-out instead.
 */
export function OnboardingTopBar({ variant }: { variant: "steps" | "live" }) {
  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b bg-card px-4 sm:h-20 sm:px-8">
      <Logo />
      {variant === "steps" ? (
        <button
          type="submit"
          form={STEP_FORM_ID}
          name="intent"
          value="later"
          className="-mx-2 min-h-11 rounded-md px-2 text-label text-foreground underline underline-offset-4 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Save and finish later
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <Link
            href="/app"
            className="min-h-11 content-center rounded-md px-3 text-label underline underline-offset-4 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Go to dashboard
          </Link>
          <SignOutButton />
        </div>
      )}
    </header>
  );
}

import { Logo } from "@/components/shared/logo";

import { STEP_FORM_ID } from "./step-shell";

/**
 * Wizard steps: "Save and finish later" submits the current step's form with
 * intent=later (save if valid, then the "Setup saved" screen). Other
 * onboarding pages show just the logo.
 */
export function OnboardingTopBar({ variant }: { variant: "steps" | "plain" }) {
  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b bg-card px-4 sm:h-20 sm:px-8">
      <Logo />
      {variant === "steps" && (
        <button
          type="submit"
          form={STEP_FORM_ID}
          name="intent"
          value="later"
          className="-mx-2 min-h-11 rounded-md px-2 text-label text-foreground underline underline-offset-4 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Save and finish later
        </button>
      )}
    </header>
  );
}

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/validation/onboarding";

/** The id every wizard step gives its <form>, so "Save and finish later" can submit it. */
export const STEP_FORM_ID = "onboarding-step-form";

type Props = {
  step: OnboardingStep;
  title: string;
  description: string;
  children: ReactNode;
  /** The live booking-page preview, shown beside the card on wide screens. */
  preview: ReactNode;
};

/** Progress header, the step's card, and the live preview column. */
export function StepShell({ step, title, description, children, preview }: Props) {
  const current = ONBOARDING_STEPS[step - 1]!;

  return (
    <main className="flex flex-1 justify-center bg-background px-4 py-8 sm:px-8 sm:py-12">
      <div className="grid w-full max-w-6xl gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <nav aria-label="Setup progress">
            <p className="text-body-sm text-muted-foreground">
              Step {step} of {ONBOARDING_STEPS.length} · {current.label}
            </p>
            <ol className="mt-4 grid grid-cols-4 gap-2 sm:gap-3">
              {ONBOARDING_STEPS.map((item) => {
                const reached = item.step <= step;
                return (
                  <li key={item.step} aria-current={item.step === step ? "step" : undefined}>
                    <span
                      aria-hidden
                      className={cn("block h-1 rounded-full", reached ? "bg-primary" : "bg-border")}
                    />
                    <span
                      className={cn(
                        "mt-3 hidden text-body-sm sm:block",
                        reached ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      <span className="sr-only">
                        {item.step < step ? "Done: " : item.step === step ? "Current: " : "Next: "}
                      </span>
                      {item.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>

          <section
            aria-labelledby="step-title"
            className="mt-8 rounded-xl border bg-card p-6 shadow-xs sm:p-10"
          >
            <h1 id="step-title" className="text-heading sm:text-display">
              {title}
            </h1>
            <p className="mt-2 text-body text-muted-foreground">{description}</p>
            <div className="mt-8">{children}</div>
          </section>
        </div>

        <aside className="hidden lg:block">
          <p className="text-body-sm text-muted-foreground">Live preview · your booking page</p>
          <div className="mt-4">{preview}</div>
        </aside>
      </div>
    </main>
  );
}

export function StepSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading setup"
      className="flex flex-1 justify-center bg-background px-4 py-8 sm:px-8 sm:py-12"
    >
      <div className="grid w-full max-w-6xl gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="mt-4 grid grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-1 animate-pulse rounded-full bg-muted" />
            ))}
          </div>
          <div className="mt-8 h-96 animate-pulse rounded-xl border bg-card" />
        </div>
        <div className="hidden h-[34rem] animate-pulse rounded-[1.75rem] bg-muted lg:block" />
      </div>
    </main>
  );
}

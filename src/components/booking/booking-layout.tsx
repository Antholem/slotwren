import { Check, ChevronLeft, CircleCheck, Loader2, MapPin } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { type PublicBusinessProfile, type Step, STEP_LABELS, STEPS } from "@/lib/booking-page";
import { initialsOf } from "@/lib/color";
import { cn } from "@/lib/utils";

/*
 * The booking page's frame (docs/design/booking-flow): a compact top bar with
 * Back on phones, the business and a stepper on desktop, the step's content,
 * and its summary: a sticky bottom bar on phones, a "Your booking" card beside
 * the content from lg up. Brand colour arrives through the primary tokens.
 */

export function BusinessMark({
  business,
  className,
}: {
  business: Pick<PublicBusinessProfile, "name" | "logoUrl">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary-tint text-primary-tint-foreground",
        className,
      )}
    >
      {business.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user upload on Supabase Storage
        <img src={business.logoUrl} alt="" className="size-full object-contain" />
      ) : (
        <span aria-hidden className="font-medium">
          {initialsOf(business.name)}
        </span>
      )}
    </span>
  );
}

/** Top bar: Back + name on phones (not on the first step), business + stepper on desktop. */
export function BookingTopBar({
  business,
  step,
  backHref,
  openToday,
  stepHrefs = {},
}: {
  business: PublicBusinessProfile;
  step: Step | "done";
  backHref: Route | null;
  /** Shown beside the address on the first step (desktop). */
  openToday?: string | null;
  /** Where each finished step links back to (desktop stepper). */
  stepHrefs?: Partial<Record<Step, Route>>;
}) {
  return (
    // Phones show the business itself on the first step instead (BusinessIntro).
    <header className={cn("border-b bg-card", step === "service" && "hidden lg:block")}>
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 lg:h-20 lg:px-6">
        {backHref ? (
          <Link
            href={backHref}
            className="-ml-2 flex size-11 items-center justify-center rounded-lg hover:bg-muted lg:hidden"
          >
            <ChevronLeft aria-hidden className="size-6" />
            <span className="sr-only">Back</span>
          </Link>
        ) : (
          <span aria-hidden className="size-11 lg:hidden" />
        )}
        <p className="flex-1 truncate text-center text-title lg:hidden">{business.name}</p>
        <span aria-hidden className="size-11 lg:hidden" />

        <div className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
          <BusinessMark business={business} className="size-12 rounded-xl text-label" />
          <div className="min-w-0">
            <p className="truncate text-title">{business.name}</p>
            <div className="flex items-center gap-4 text-body-sm text-muted-foreground">
              {business.address && <p className="truncate">{business.address}</p>}
              {openToday !== undefined && <OpenToday openToday={openToday} />}
            </div>
          </div>
        </div>
        {step !== "done" && <DesktopStepper step={step} hrefs={stepHrefs} />}
      </div>
    </header>
  );
}

/** Desktop stepper; finished steps link back to change them. */
function DesktopStepper({ step, hrefs }: { step: Step; hrefs: Partial<Record<Step, Route>> }) {
  const current = STEPS.indexOf(step);
  return (
    <ol aria-label="Booking steps" className="hidden items-center gap-3 lg:flex">
      {STEPS.map((id, i) => (
        <li key={id} className="flex items-center gap-3">
          {i > 0 && <span aria-hidden className="h-px w-8 bg-border" />}
          <StepLabel
            href={i < current ? hrefs[id] : undefined}
            current={i === current}
            later={i > current}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-7 items-center justify-center rounded-full text-body-sm",
                i < current && "bg-primary-tint text-primary-tint-foreground",
                i === current && "bg-primary text-primary-foreground",
                i > current && "border border-input",
              )}
            >
              {i < current ? <Check className="size-4" strokeWidth={2.5} /> : i + 1}
            </span>
            {STEP_LABELS[id]}
            {i < current && <span className="sr-only"> (done)</span>}
          </StepLabel>
        </li>
      ))}
    </ol>
  );
}

function StepLabel({
  href,
  current,
  later,
  children,
}: {
  href?: Route;
  current: boolean;
  later: boolean;
  children: ReactNode;
}) {
  const className = cn(
    "flex min-h-11 items-center gap-2 rounded-lg text-label",
    later && "text-muted-foreground",
  );
  return href ? (
    <Link href={href} className={cn(className, "underline-offset-4 hover:underline")}>
      {children}
    </Link>
  ) : (
    <span aria-current={current ? "step" : undefined} className={className}>
      {children}
    </span>
  );
}

/** "Step 2 of 4 · Staff … Next: Date and time" with four bars (phones and tablets). */
export function StepProgress({ step }: { step: Step }) {
  const index = STEPS.indexOf(step);
  const next = STEPS[index + 1];
  return (
    <div className="flex flex-col gap-3 lg:hidden">
      <div className="flex items-baseline justify-between gap-4 text-body-sm">
        <p className="text-label">
          Step {index + 1} of {STEPS.length} · {STEP_LABELS[step]}
        </p>
        <p className="text-muted-foreground">{next ? `Next: ${STEP_LABELS[next]}` : "Last step"}</p>
      </div>
      <div aria-hidden className="grid grid-cols-4 gap-2">
        {STEPS.map((id, i) => (
          <span
            key={id}
            className={cn("h-1.5 rounded-full", i <= index ? "bg-primary" : "bg-border")}
          />
        ))}
      </div>
    </div>
  );
}

/** The step's main column plus its summary card (desktop) and bottom bar (phones). */
export function StepLayout({
  children,
  aside,
  bar,
}: {
  children: ReactNode;
  aside: ReactNode;
  bar?: ReactNode;
}) {
  return (
    <>
      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-5 pt-6 pb-32 lg:grid-cols-[minmax(0,1fr)_22rem] lg:px-6 lg:pt-12 lg:pb-16">
        <div className="flex min-w-0 flex-col gap-6">{children}</div>
        <aside className="hidden lg:block">
          <div className="sticky top-6">{aside}</div>
        </aside>
      </div>
      {bar}
    </>
  );
}

export type SummaryRow = { label: string; value: ReactNode };

export type StepAction = {
  label: string;
  disabled?: boolean;
  pending?: boolean;
  onClick?: () => void;
  /** Submit this form instead of clicking. */
  form?: string;
};

function ActionButton({ action, className }: { action: StepAction; className?: string }) {
  return (
    <Button
      type={action.form ? "submit" : "button"}
      form={action.form}
      disabled={action.disabled || action.pending}
      onClick={action.onClick}
      className={cn("h-12 px-6 text-label", className)}
    >
      {action.pending && <Loader2 aria-hidden className="animate-spin" />}
      {action.label}
    </Button>
  );
}

/** "Your booking": the choices so far, the total and the step's action (desktop). */
export function SummaryCard({
  rows,
  total,
  action,
  policy,
}: {
  rows: SummaryRow[];
  total?: string | null;
  action?: StepAction;
  policy?: string;
}) {
  return (
    <section
      aria-labelledby="summary-title"
      className="flex flex-col gap-5 rounded-2xl border bg-card p-6 shadow-xs"
    >
      <h2 id="summary-title" className="text-title">
        Your booking
      </h2>
      <dl className="flex flex-col gap-3 text-body">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right">{row.value}</dd>
          </div>
        ))}
      </dl>
      {total && (
        <div className="flex items-baseline justify-between border-t pt-5">
          <span className="text-body text-muted-foreground">Total</span>
          <span className="font-mono text-heading tabular-nums">{total}</span>
        </div>
      )}
      {action && <ActionButton action={action} className="w-full" />}
      {policy && <Policy text={policy} />}
    </section>
  );
}

export function Policy({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-body-sm text-success-text">
      <CircleCheck aria-hidden className="size-4 shrink-0" />
      {text}
    </p>
  );
}

/** Sticky summary and action at the foot of the screen on phones. */
export function BottomBar({
  title,
  detail,
  action,
}: {
  title: ReactNode;
  detail: ReactNode;
  action: StepAction;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-card lg:hidden">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-label">{title}</p>
          <p className="truncate text-body-sm text-muted-foreground">{detail}</p>
        </div>
        <ActionButton action={action} />
      </div>
    </div>
  );
}

/** Address and today's opening hours under the business name (first step). */
export function BusinessIntro({
  business,
  openToday,
}: {
  business: PublicBusinessProfile;
  openToday: string | null;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 pt-8 lg:hidden">
      <BusinessMark business={business} className="size-14 text-title" />
      <p className="text-display">{business.name}</p>
      <div className="flex flex-col gap-2 text-body text-muted-foreground">
        {business.address && (
          <p className="flex items-center gap-2">
            <MapPin aria-hidden className="size-4 shrink-0" />
            {business.address}
          </p>
        )}
        <OpenToday openToday={openToday} />
      </div>
    </div>
  );
}

export function OpenToday({ openToday }: { openToday: string | null }) {
  return openToday ? (
    <p className="flex items-center gap-2">
      <span aria-hidden className="size-2 rounded-full bg-success" />
      <span className="text-success-text">Open today</span>
      <span className="font-mono text-foreground tabular-nums">{openToday}</span>
    </p>
  ) : (
    <p className="flex items-center gap-2">
      <span aria-hidden className="size-2 rounded-full bg-muted-foreground" />
      Closed today
    </p>
  );
}

export function PoweredBy() {
  return (
    <footer className="flex items-center justify-center gap-2 py-8 text-body-sm text-muted-foreground">
      Powered by <Logo className="scale-90" />
    </footer>
  );
}

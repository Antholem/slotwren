"use client";

import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import type { Result } from "@/lib/result";
import { slugSchema } from "@/lib/slug";
import { cn } from "@/lib/utils";

/*
 * The booking-link field with a live availability check. Shared by
 * onboarding's "Business basics" and Settings → Business.
 */

export type SlugStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "taken" }
  | { state: "invalid"; message: string };

type Props = {
  id: string;
  statusId: string;
  /** "slotwren.com": shown before "/b/". */
  host: string;
  status: SlugStatus;
  error?: string;
  inputProps: UseFormRegisterReturn;
  /** More ids for aria-describedby (a warning, a hint). */
  describedBy?: string;
};

export function SlugField({ id, statusId, host, status, error, inputProps, describedBy }: Props) {
  return (
    <>
      <div
        className={cn(
          "flex h-11 items-center rounded-lg border border-input px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          error && "border-destructive ring-3 ring-destructive/20",
        )}
      >
        <span aria-hidden className="shrink-0 font-mono text-mono text-muted-foreground">
          {host}/b/
        </span>
        <input
          id={id}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!!error || undefined}
          aria-describedby={[statusId, describedBy].filter(Boolean).join(" ")}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-mono outline-none"
          {...inputProps}
        />
      </div>
      <div id={statusId} aria-live="polite" className="min-h-5 text-body-sm">
        {error ? (
          <span className="flex items-center gap-1.5 text-danger-text">
            <CircleAlert aria-hidden className="size-4" />
            {error}
          </span>
        ) : (
          <SlugStatusLine status={status} />
        )}
      </div>
    </>
  );
}

function SlugStatusLine({ status }: { status: SlugStatus }) {
  switch (status.state) {
    case "checking":
      return (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Checking…
        </span>
      );
    case "available":
      return (
        <span className="flex items-center gap-1.5 text-success-text">
          <CircleCheck aria-hidden className="size-4" />
          Available
        </span>
      );
    case "taken":
      return (
        <span className="flex items-center gap-1.5 text-danger-text">
          <CircleAlert aria-hidden className="size-4" />
          Taken. Try adding your area or a number.
        </span>
      );
    case "invalid":
      return <span className="text-muted-foreground">{status.message}</span>;
    default:
      return null;
  }
}

/**
 * Debounced availability check as the owner types. `currentSlug` (the
 * business's saved link) needs no check.
 */
export function useSlugStatus(
  slug: string,
  check: (slug: string) => Promise<Result<{ available: boolean }>>,
  currentSlug?: string,
): SlugStatus {
  const [status, setStatus] = useState<SlugStatus>({ state: "idle" });

  useEffect(() => {
    if (!slug || slug === currentSlug) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when there's nothing to check
      setStatus({ state: "idle" });
      return;
    }
    const parsed = slugSchema.safeParse(slug);
    if (!parsed.success) {
      setStatus({ state: "invalid", message: parsed.error.issues[0]!.message });
      return;
    }
    let cancelled = false;
    setStatus({ state: "checking" });
    const timer = setTimeout(async () => {
      const result = await check(parsed.data);
      if (cancelled) return;
      if (!result.ok) setStatus({ state: "invalid", message: result.error.message });
      else setStatus({ state: result.data.available ? "available" : "taken" });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, check, currentSlug]);

  return status;
}

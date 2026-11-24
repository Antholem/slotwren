"use client";

import { ArrowDown, CalendarDays, Loader2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type BookingState,
  manageHref,
  type PublicBusinessProfile,
  type PublicService,
} from "@/lib/booking-page";
import type { Result } from "@/lib/result";

import { LocalRange, LocalTime } from "./local-time";
import { TimeStep } from "./time-step";

/*
 * The manage page's interactive parts (src/app/m/[token]): Reschedule and
 * Cancel, the time picker (the booking page's own, keeping the same person),
 * and the confirm step. Changes go through rescheduleBooking/cancelBooking
 * via the page's server actions.
 */

type MoveAction = (token: string, startsAt: string) => Promise<Result<{ manageToken: string }>>;
type CancelAction = (token: string) => Promise<Result<{ id: string }>>;

/** The booking page's time step, pointed at the manage page. */
export function ManageTimeStep({
  token,
  slug,
  business,
  service,
  staffName,
  staffId,
  date,
  taken,
  now,
  startsAt,
}: {
  token: string;
  slug: string;
  business: PublicBusinessProfile;
  service: PublicService;
  staffName: string;
  staffId: string;
  date: string | null;
  taken: string | null;
  now: string;
  /** The booking's current start (ISO): the picker opens on its day. */
  startsAt: string;
}) {
  const state: BookingState = {
    step: "time",
    serviceId: service.id,
    staffId,
    date,
    start: null,
    taken,
  };
  return (
    <TimeStep
      slug={slug}
      business={business}
      service={service}
      withWhom={staffName}
      canChooseStaff={false}
      state={state}
      now={now}
      manageToken={token}
      showProgress={false}
      hrefFor={(next) => manageHref(token, next)}
      openAt={startsAt}
    />
  );
}

/** Reschedule and Cancel (with a confirm dialog) under the booking. */
export function ManageActions({
  token,
  cancel,
  businessName,
  confirmationHref,
}: {
  token: string;
  cancel: CancelAction;
  businessName: string;
  /** Where to land after cancelling: cancelling revokes this link too. */
  confirmationHref: Route;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancel(token);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setOpen(false);
      // Cancelling revoked every manage link, this one included: the booking's
      // confirmation page (keyed by its ID) shows the cancelled state.
      router.replace(confirmationHref);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Button asChild variant="secondary" className="h-14 border text-title">
        <Link href={manageHref(token, { step: "time" })}>
          <CalendarDays aria-hidden className="size-5" />
          Reschedule
        </Link>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <Button
          variant="ghost"
          className="h-12 text-title text-danger-text hover:bg-danger-soft hover:text-danger-text"
          onClick={() => setOpen(true)}
        >
          Cancel booking
        </Button>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel this booking?</DialogTitle>
            <DialogDescription>
              {businessName} will be told, and we&rsquo;ll email you a receipt. You can book again
              any time.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft p-3 text-body-sm text-danger-text">
              {error}
            </p>
          )}
          <DialogFooter className="gap-3">
            <DialogClose asChild>
              <Button variant="secondary" className="h-11 px-4 text-label">
                Keep booking
              </Button>
            </DialogClose>
            <Button
              disabled={pending}
              onClick={confirmCancel}
              className="h-11 bg-destructive px-4 text-label text-destructive-foreground hover:bg-destructive-hover"
            >
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              Cancel booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "Move your booking": from the old time to the new, then Confirm. */
export function ManageConfirm({
  token,
  from,
  to,
  date,
  serviceName,
  staffName,
  move,
}: {
  token: string;
  from: { start: string; end: string };
  to: { start: string; end: string };
  date: string | null;
  serviceName: string;
  staffName: string;
  move: MoveAction;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await move(token, to.start);
      if (result.ok) {
        // The old link is retired: carry on at the new one.
        router.replace(manageHref(result.data.manageToken, { done: "moved" }));
        return;
      }
      if (result.error.code === "slot_taken" || result.error.code === "slot_unavailable") {
        router.replace(manageHref(token, { step: "time", date, taken: to.start }));
        return;
      }
      setError(result.error.message);
    });
  }

  const slot = (label: string, times: { start: string; end: string }, muted = false) => (
    <div className={muted ? "text-muted-foreground" : undefined}>
      <p className="text-body-sm text-muted-foreground">{label}</p>
      <p className="text-title">
        <LocalTime value={times.start} pattern="EEEE, d MMMM" placeholder="…" />
      </p>
      <LocalRange start={times.start} end={times.end} className="text-heading" />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="move-title"
        className="flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-xs"
      >
        <h2 id="move-title" className="text-title">
          Move your {serviceName} with {staffName}
        </h2>
        {slot("From", from, true)}
        <ArrowDown aria-hidden className="size-5 text-muted-foreground" />
        {slot("To", to)}
      </section>
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft p-4 text-body text-danger-text">
          {error}
        </p>
      )}
      <Button onClick={confirm} disabled={pending} className="h-12 text-label">
        {pending && <Loader2 aria-hidden className="animate-spin" />}
        Confirm new time
      </Button>
      <Button asChild variant="ghost" className="h-11 text-label">
        <Link href={manageHref(token, { step: "time", date })}>Pick another time</Link>
      </Button>
    </div>
  );
}

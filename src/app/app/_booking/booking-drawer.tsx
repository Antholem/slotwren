"use client";

import { Info, Loader2 } from "lucide-react";
import { useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { NativeSelect } from "@/components/shared/native-select";
import { formatInZone } from "@/lib/dates";
import { formatDuration } from "@/lib/hours";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { FreeStaff, MemberSlot } from "@/server/booking/service";
import type { BookingDetail, BookingEventRow, BookingOptions } from "@/server/db/queries/calendar";

import { cancelFromTodayAction, recordOutcomeAction } from "../actions";
import { bookingDetailAction, freeStaffAction, rescheduleAction } from "../booking-actions";
import { SourceBadge, StaffName, StatusBadge, TimeChips, useMemberSlots } from "./booking-ui";

type Mode = "view" | "reschedule" | "staff" | "cancel";

type Loaded =
  | { status: "loading" }
  | { status: "ready"; detail: BookingDetail }
  | { status: "error"; message: string };

/** "Booking details" (docs/design/owner-dashboard/2-calendar-booking-drawer-open). */
export function BookingDrawer({
  bookingId,
  onClose,
  zone,
  currency,
  role,
  options,
}: {
  bookingId: string | null;
  onClose: () => void;
  zone: string;
  currency: string;
  role: "owner" | "staff";
  options: BookingOptions;
}) {
  return (
    <Sheet open={!!bookingId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-md"
      >
        {bookingId && (
          <DrawerBody
            key={bookingId}
            bookingId={bookingId}
            zone={zone}
            currency={currency}
            role={role}
            options={options}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  bookingId,
  zone,
  currency,
  role,
  options,
}: {
  bookingId: string;
  zone: string;
  currency: string;
  role: "owner" | "staff";
  options: BookingOptions;
}) {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<{ version: number; value: Loaded } | null>(null);
  const [mode, setMode] = useState<Mode>("view");

  useEffect(() => {
    let live = true;
    bookingDetailAction(bookingId)
      .then((result) => {
        if (!live) return;
        setLoaded({
          version,
          value: result.ok
            ? { status: "ready", detail: result.data }
            : { status: "error", message: result.error.message },
        });
      })
      .catch(() => {
        if (live) {
          setLoaded({
            version,
            value: { status: "error", message: "Couldn't load this booking. Try again." },
          });
        }
      });
    return () => {
      live = false;
    };
  }, [bookingId, version]);

  const reload = () => {
    setMode("view");
    setVersion((v) => v + 1);
  };
  // Keep showing the last detail while a reload is in flight.
  const state: Loaded = loaded?.value ?? { status: "loading" };

  return (
    <>
      <SheetHeader className="border-b px-6 py-5 pr-14">
        <SheetTitle className="text-title">Booking details</SheetTitle>
        <SheetDescription className="sr-only">
          The appointment, its history, and what you can change.
        </SheetDescription>
      </SheetHeader>
      {state.status === "loading" && <DrawerSkeleton />}
      {state.status === "error" && (
        <div className="flex flex-col items-start gap-3 px-6 py-6">
          <p role="alert" className="text-body text-danger-text">
            {state.message}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="h-11 px-4 text-label"
            onClick={() => setVersion((v) => v + 1)}
          >
            Try again
          </Button>
        </div>
      )}
      {state.status === "ready" && (
        <Detail
          detail={state.detail}
          zone={zone}
          currency={currency}
          role={role}
          options={options}
          mode={mode}
          setMode={setMode}
          onChanged={reload}
        />
      )}
    </>
  );
}

function Detail({
  detail: d,
  zone,
  currency,
  role,
  options,
  mode,
  setMode,
  onChanged,
}: {
  detail: BookingDetail;
  zone: string;
  currency: string;
  role: "owner" | "staff";
  options: BookingOptions;
  mode: Mode;
  setMode: (mode: Mode) => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const now = new Date();
  const active = d.status === "pending" || d.status === "confirmed";
  const canChange = active && (role === "owner" || d.isMine);
  const started = now >= d.startsAt;
  const time = (date: Date) => formatInZone(date, zone, "HH:mm");
  const freeUntil = new Date(d.startsAt.getTime() - d.cancellationWindowHours * 3_600_000);
  const staffNames = Object.fromEntries(options.staff.map((s) => [s.id, s.name]));

  function mark(outcome: "completed" | "no_show") {
    startTransition(async () => {
      const result = await recordOutcomeAction(d.id, outcome);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(outcome === "completed" ? "Marked complete" : "Marked no-show");
      onChanged();
    });
  }

  return (
    <div className="flex min-h-[calc(100%-4.5rem)] flex-col">
      <div className="flex flex-1 flex-col gap-6 px-6 py-6">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={d.status} />
          <SourceBadge source={d.source} />
        </div>
        <div>
          <p
            className={cn(
              "font-mono text-heading tabular-nums",
              d.status === "cancelled" && "line-through",
            )}
          >
            {time(d.startsAt)} – {time(d.endsAt)}
          </p>
          <p className="text-body text-muted-foreground">
            {formatInZone(d.startsAt, zone, "EEEE, d MMMM")} ·{" "}
            {formatDuration((d.endsAt.getTime() - d.startsAt.getTime()) / 60_000)}
          </p>
        </div>

        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-body">
          <dt className="text-muted-foreground">Service</dt>
          <dd>{d.serviceName}</dd>
          <dt className="text-muted-foreground">With</dt>
          <dd>
            <StaffName name={d.staffName} color={d.staffColor} />
          </dd>
          <dt className="text-muted-foreground">Customer</dt>
          <dd className="min-w-0">
            <span className="block">{d.customerName}</span>
            <a
              href={`mailto:${d.customerEmail}`}
              className="block truncate text-body-sm text-primary underline underline-offset-4"
            >
              {d.customerEmail}
            </a>
            {d.customerPhone && (
              <a
                href={`tel:${d.customerPhone}`}
                className="block text-body-sm text-primary underline underline-offset-4"
              >
                {d.customerPhone}
              </a>
            )}
          </dd>
          <dt className="text-muted-foreground">Price</dt>
          <dd className="font-mono tabular-nums">{formatPrice(d.priceCents, currency)}</dd>
          <dt className="text-muted-foreground">Code</dt>
          <dd className="font-mono tabular-nums">{d.code}</dd>
          <dt className="text-muted-foreground">Notes</dt>
          <dd className={d.notes ? "whitespace-pre-line" : "text-muted-foreground"}>
            {d.notes ?? "None"}
          </dd>
          {d.cancelReason && (
            <>
              <dt className="text-muted-foreground">Reason</dt>
              <dd>{d.cancelReason}</dd>
            </>
          )}
        </dl>

        {mode === "view" && (
          <>
            <section
              aria-labelledby="booking-history"
              className="flex flex-col gap-3 border-t pt-5"
            >
              <h3 id="booking-history" className="text-label">
                History
              </h3>
              <ol className="flex flex-col gap-3">
                {d.events.map((event) => (
                  <li
                    key={event.id}
                    className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 text-body"
                  >
                    <span className="font-mono text-body-sm text-muted-foreground tabular-nums">
                      {formatInZone(event.createdAt, zone, "d MMM")}
                      <br />
                      {formatInZone(event.createdAt, zone, "HH:mm")}
                    </span>
                    <span>{describeEvent(event, d, zone, staffNames)}</span>
                  </li>
                ))}
                {d.events.length === 0 && (
                  <li className="text-body-sm text-muted-foreground">No history yet.</li>
                )}
              </ol>
            </section>
            {active && d.cancellationWindowHours > 0 && freeUntil > now && (
              <p className="flex gap-3 rounded-xl bg-info-soft p-4 text-body-sm text-info-text">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  {d.customerName} can cancel or move it online until{" "}
                  {formatInZone(freeUntil, zone, "EEE d MMM")},{" "}
                  <span className="font-mono tabular-nums">{time(freeUntil)}</span>.
                </span>
              </p>
            )}
            {active && !canChange && (
              <p className="text-body-sm text-muted-foreground">
                This is {d.staffName}&rsquo;s booking. Ask an owner to change it.
              </p>
            )}
          </>
        )}

        {mode === "reschedule" && (
          <Reschedule
            detail={d}
            zone={zone}
            role={role}
            options={options}
            onCancel={() => setMode("view")}
            onDone={onChanged}
          />
        )}
        {mode === "staff" && (
          <ChangeStaff detail={d} onCancel={() => setMode("view")} onDone={onChanged} />
        )}
        {mode === "cancel" && (
          <CancelBooking detail={d} onCancel={() => setMode("view")} onDone={onChanged} />
        )}
      </div>

      {mode === "view" && canChange && (
        <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-card px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="secondary"
              className="h-11 px-4 text-label"
              onClick={() => setMode("reschedule")}
            >
              Reschedule
            </Button>
            {role === "owner" ? (
              <Button
                type="button"
                variant="secondary"
                className="h-11 px-4 text-label"
                onClick={() => setMode("staff")}
              >
                Change staff
              </Button>
            ) : (
              <span />
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={!started || pending}
              className="h-11 px-4 text-label"
              onClick={() => mark("completed")}
            >
              Complete
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!started || pending}
              className="h-11 px-4 text-label"
              onClick={() => mark("no_show")}
            >
              Mark no-show
            </Button>
          </div>
          {!started && (
            <p className="text-body-sm text-muted-foreground">
              Complete and No-show unlock at{" "}
              <span className="font-mono tabular-nums">{time(d.startsAt)}</span>.
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            className="h-11 px-4 text-label text-danger-text hover:text-danger-text"
            onClick={() => setMode("cancel")}
          >
            Cancel booking
          </Button>
        </div>
      )}
    </div>
  );
}

function Reschedule({
  detail: d,
  zone,
  role,
  options,
  onCancel,
  onDone,
}: {
  detail: BookingDetail;
  zone: string;
  role: "owner" | "staff";
  options: BookingOptions;
  onCancel: () => void;
  onDone: () => void;
}) {
  const id = useId();
  // The booking's own date, on the business's calendar.
  const [date, setDate] = useState(() => formatInZone(d.startsAt, zone, "yyyy-MM-dd"));
  const people =
    role === "owner"
      ? options.staff.filter((s) => s.serviceIds.includes(d.serviceId) || s.id === d.staffId)
      : options.staff.filter((s) => s.id === d.staffId);
  const [staffId, setStaffId] = useState(d.staffId);
  const [version, setVersion] = useState(0);
  const [slot, setSlot] = useState<MemberSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const slots = useMemberSlots(
    { serviceId: d.serviceId, staffId, date, excludeBookingId: d.id },
    version,
  );
  const chosen =
    slot && slots.status === "ready" && slots.slots.some((s) => s.start === slot.start)
      ? slot
      : null;

  function save() {
    if (!chosen) {
      setError("Pick a new time.");
      return;
    }
    startTransition(async () => {
      const result = await rescheduleAction(d.id, { startsAt: chosen.start, staffId });
      if (!result.ok) {
        setError(result.error.message);
        setSlot(null);
        setVersion((v) => v + 1);
        return;
      }
      toast.success(`Moved to ${chosen.time}`, { description: "The customer has been emailed." });
      onDone();
    });
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-5 border-t pt-5">
      <h3 id={`${id}-title`} className="text-label">
        Reschedule
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-date`} className="text-label">
            Date
          </Label>
          <Input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setSlot(null);
              setError(null);
            }}
            className="h-11 px-3 font-mono text-body tabular-nums md:text-body"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-staff`} className="text-label">
            With
          </Label>
          <NativeSelect
            id={`${id}-staff`}
            value={staffId}
            disabled={people.length < 2}
            onChange={(event) => {
              setStaffId(event.target.value);
              setSlot(null);
            }}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <TimeChips
        name={`${id}-time`}
        legend="New time"
        state={slots}
        value={chosen?.start ?? null}
        onChange={(next) => {
          setSlot(next);
          setError(null);
        }}
        emptyText="No free times that day. Try another date or person."
      />
      {error && (
        <p role="alert" className="text-body-sm text-danger-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" className="h-11 px-4 text-label" onClick={onCancel}>
          Back
        </Button>
        <Button type="button" disabled={pending} className="h-11 px-4 text-label" onClick={save}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Move booking
        </Button>
      </div>
    </section>
  );
}

function ChangeStaff({
  detail: d,
  onCancel,
  onDone,
}: {
  detail: BookingDetail;
  onCancel: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const [free, setFree] = useState<FreeStaff[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    freeStaffAction(d.id)
      .then((people) => live && setFree(people))
      .catch(() => live && setFree([]));
    return () => {
      live = false;
    };
  }, [d.id]);

  function save() {
    const to = free?.find((p) => p.id === choice);
    if (!to) {
      setError("Pick who takes it.");
      return;
    }
    startTransition(async () => {
      const result = await rescheduleAction(d.id, {
        startsAt: d.startsAt.toISOString(),
        staffId: to.id,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(`Now with ${to.name}`, { description: "The customer has been emailed." });
      onDone();
    });
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4 border-t pt-5">
      <h3 id={`${id}-title`} className="text-label">
        Change staff
      </h3>
      {free === null && (
        <p aria-busy="true" className="text-body-sm text-muted-foreground">
          Checking who&rsquo;s free…
        </p>
      )}
      {free?.length === 0 && (
        <p className="text-body-sm text-muted-foreground">
          Nobody else who does {d.serviceName} is free at this time. Reschedule it instead.
        </p>
      )}
      {free && free.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-body-sm text-muted-foreground">
            Free at this time and does {d.serviceName}
          </legend>
          {free.map((person) => (
            <label
              key={person.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-4 has-checked:border-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name={`${id}-staff`}
                value={person.id}
                checked={choice === person.id}
                onChange={() => {
                  setChoice(person.id);
                  setError(null);
                }}
                className="size-4 accent-[var(--color-primary)]"
              />
              <StaffName name={person.name} color={person.color} />
            </label>
          ))}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-danger-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" className="h-11 px-4 text-label" onClick={onCancel}>
          Back
        </Button>
        <Button
          type="button"
          disabled={pending || !free?.length}
          className="h-11 px-4 text-label"
          onClick={save}
        >
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Reassign
        </Button>
      </div>
    </section>
  );
}

function CancelBooking({
  detail: d,
  onCancel,
  onDone,
}: {
  detail: BookingDetail;
  onCancel: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const [notify, setNotify] = useState(true);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await cancelFromTodayAction(d.id, notify);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Booking cancelled", {
        description:
          result.data.notified === null
            ? undefined
            : result.data.notified
              ? "We've emailed the customer."
              : "Email isn't set up yet, so the customer wasn't emailed.",
      });
      onDone();
    });
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4 rounded-xl border border-danger-text/40 p-4"
    >
      <h3 id={`${id}-title`} className="text-label">
        Cancel this booking?
      </h3>
      <p className="text-body-sm text-muted-foreground">The time opens up for booking again.</p>
      <label htmlFor={`${id}-notify`} className="flex min-h-11 cursor-pointer items-center gap-3">
        <Checkbox
          id={`${id}-notify`}
          className="size-5"
          checked={notify}
          onCheckedChange={(on) => setNotify(on === true)}
        />
        <span className="text-body">Email {d.customerName} to let them know</span>
      </label>
      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" className="h-11 px-4 text-label" onClick={onCancel}>
          Keep it
        </Button>
        <Button
          type="button"
          disabled={pending}
          className="h-11 bg-destructive px-4 text-label text-destructive-foreground hover:bg-destructive-hover"
          onClick={confirm}
        >
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Cancel booking
        </Button>
      </div>
    </section>
  );
}

function describeEvent(
  event: BookingEventRow,
  d: BookingDetail,
  zone: string,
  staffNames: Record<string, string>,
): string {
  const by = event.actorName
    ? ` by ${event.actorName}`
    : event.actor === "staff"
      ? " by the team"
      : "";
  const data = event.data ?? {};
  switch (event.type) {
    case "created": {
      if (event.actor === "staff") return `Booked${by}`;
      const source = (data.source as string | undefined) ?? d.source;
      if (source === "ai") return `Confirmed by ${d.customerName} in the AI receptionist chat`;
      if (source === "widget") return `Booked by ${d.customerName} on your website`;
      return `Booked by ${d.customerName} on the booking page`;
    }
    case "rescheduled": {
      const to = data.to as { startsAt?: string; staffId?: string } | undefined;
      const from = data.from as { startsAt?: string; staffId?: string } | undefined;
      const who = event.actor === "customer" ? ` by ${d.customerName}` : by;
      if (to?.startsAt && from?.startsAt === to.startsAt && to.staffId) {
        return `Moved to ${staffNames[to.staffId] ?? "another staff member"}${who}`;
      }
      const when = to?.startsAt
        ? formatInZone(new Date(to.startsAt), zone, "EEE d MMM, HH:mm")
        : "a new time";
      const with_ =
        to?.staffId && to.staffId !== from?.staffId
          ? ` with ${staffNames[to.staffId] ?? "someone else"}`
          : "";
      return `Moved to ${when}${with_}${who}`;
    }
    case "cancelled":
      return event.actor === "customer" ? `Cancelled by ${d.customerName}` : `Cancelled${by}`;
    case "completed":
      return `Marked complete${by}`;
    case "no_show":
      return `Marked no-show${by}`;
    case "reminder_sent":
      return `Reminder email sent to ${d.customerEmail}`;
  }
}

function DrawerSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading booking" className="flex flex-col gap-6 px-6 py-6">
      <div className="flex gap-2">
        <div className="h-7 w-24 animate-pulse rounded-full bg-muted" />
        <div className="h-7 w-16 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-5 w-full animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Search, UserPlus } from "lucide-react";
import { useEffect, useId, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FieldError } from "@/components/onboarding/step-footer";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatDuration } from "@/lib/hours";
import { formatPrice } from "@/lib/money";
import {
  type ManualBookingFormInput,
  manualBookingFormSchema,
  type ManualBookingFormValues,
} from "@/lib/validation/booking";
import { cn } from "@/lib/utils";
import type { MemberSlot } from "@/server/booking/service";
import type { BookingOptions, CustomerMatch } from "@/server/db/queries/calendar";

import { createManualBookingAction, searchCustomersAction } from "../booking-actions";
import { TimeChips, useMemberSlots } from "./booking-ui";

export type SheetStart = {
  /** Business-local date. */
  date: string;
  /** Business-local "HH:MM" to preselect, if it's offered. */
  time?: string;
  staffId?: string;
  /** Book for this customer (from their profile). */
  customer?: CustomerMatch;
};

/**
 * "New booking": the team books a customer in (from an empty calendar slot,
 * or the New booking button). Times come from the same rules the booking
 * service re-checks; the booking itself is created there.
 */
export function BookingSheet({
  open,
  onOpenChange,
  start,
  options,
  currency,
  staffOnly,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  start: SheetStart;
  options: BookingOptions;
  currency: string;
  /** Staff book only for themselves (RLS). */
  staffOnly: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-lg"
      >
        {open && (
          <BookingForm
            start={start}
            options={options}
            currency={currency}
            staffOnly={staffOnly}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

type Customer = { mode: "search" } | { mode: "picked"; match: CustomerMatch } | { mode: "new" };

function BookingForm({
  start,
  options,
  currency,
  staffOnly,
  onDone,
}: {
  start: SheetStart;
  options: BookingOptions;
  currency: string;
  staffOnly: boolean;
  onDone: () => void;
}) {
  const id = useId();
  const people = staffOnly ? options.staff.filter((s) => s.isMe) : options.staff;
  const firstService =
    options.services.find((s) =>
      people.some((p) => p.serviceIds.includes(s.id) && (!start.staffId || p.id === start.staffId)),
    ) ?? options.services[0];
  const [serviceId, setServiceId] = useState(firstService?.id ?? "");
  const offering = people.filter((p) => p.serviceIds.includes(serviceId));
  const [staffChoice, setStaffChoice] = useState<string>(
    start.staffId && people.some((p) => p.id === start.staffId)
      ? start.staffId
      : staffOnly
        ? (people[0]?.id ?? "any")
        : "any",
  );
  const staffId =
    staffChoice === "any" || offering.some((p) => p.id === staffChoice) ? staffChoice : "any";
  const [date, setDate] = useState(start.date);
  const [version, setVersion] = useState(0);
  const [slot, setSlot] = useState<MemberSlot | null>(null);
  const [wanted, setWanted] = useState(start.time ?? null);
  const slots = useMemberSlots(
    serviceId && date && (staffId !== "any" || offering.length > 0)
      ? { serviceId, staffId, date }
      : null,
    version,
  );

  // Preselect the clicked time once its times arrive, if it's offered.
  const offered = slots.status === "ready" ? slots.slots : [];
  const preselect = wanted ? offered.find((s) => s.time === wanted) : undefined;
  const chosen = slot && offered.some((s) => s.start === slot.start) ? slot : (preselect ?? null);
  const missedWanted = !!wanted && slots.status === "ready" && !preselect;

  const [customer, setCustomer] = useState<Customer>(
    start.customer ? { mode: "picked", match: start.customer } : { mode: "search" },
  );
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<ManualBookingFormInput, unknown, ManualBookingFormValues>({
    resolver: zodResolver(manualBookingFormSchema),
    defaultValues: {
      name: start.customer?.name ?? "",
      email: start.customer?.email ?? "",
      phone: start.customer?.phone ?? "",
      notes: "",
    },
    mode: "onTouched",
  });
  const { register, handleSubmit, formState, setValue, setError } = form;
  const { errors } = formState;

  function pick(match: CustomerMatch) {
    setCustomer({ mode: "picked", match });
    setCustomerError(null);
    setValue("name", match.name);
    setValue("email", match.email);
    setValue("phone", match.phone ?? "");
  }

  function startNew(query: string) {
    setCustomer({ mode: "new" });
    setCustomerError(null);
    setValue("name", query.includes("@") ? "" : query);
    setValue("email", query.includes("@") ? query : "");
    setValue("phone", "");
  }

  const submit = handleSubmit(
    (values) => {
      if (customer.mode === "search") {
        setCustomerError("Find a customer, or add a new one.");
        return;
      }
      if (!chosen) {
        setTimeError("Pick a time.");
        return;
      }
      setFormError(null);
      startTransition(async () => {
        const result = await createManualBookingAction({
          serviceId,
          staffId: chosen.staffId,
          startsAt: chosen.start,
          customer: { name: values.name, email: values.email, phone: values.phone },
          notes: values.notes,
        });
        if (result.ok) {
          const who = people.find((p) => p.id === chosen.staffId)?.name;
          toast.success(`Booked ${values.name} at ${chosen.time}`, {
            description: [who && `With ${who}`, result.data.code].filter(Boolean).join(" · "),
          });
          onDone();
          return;
        }
        if (result.error.code === "slot_taken" || result.error.code === "slot_unavailable") {
          setSlot(null);
          setWanted(null);
          setTimeError(result.error.message);
          setVersion((v) => v + 1);
          return;
        }
        const fields = result.error.fieldErrors ?? {};
        const customerFields = ["name", "email", "phone"] as const;
        let placed = false;
        for (const field of customerFields) {
          const message = fields[`customer.${field}`]?.[0] ?? fields[field]?.[0];
          if (message) {
            setError(field, { message });
            placed = true;
          }
        }
        if (!placed) setFormError(result.error.message);
      });
    },
    () => {
      if (customer.mode === "search") setCustomerError("Find a customer, or add a new one.");
    },
  );

  const service = options.services.find((s) => s.id === serviceId);
  const staffNames = Object.fromEntries(people.map((p) => [p.id, p.name]));

  if (options.services.length === 0 || people.length === 0) {
    return (
      <>
        <SheetHeader className="gap-1 border-b px-6 py-5">
          <SheetTitle className="text-title">New booking</SheetTitle>
          <SheetDescription className="text-body-sm text-muted-foreground">
            {options.services.length === 0
              ? "Add a service first, then book customers in here."
              : "You aren't set up to take bookings yet. Ask an owner to add you to a service."}
          </SheetDescription>
        </SheetHeader>
      </>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="flex min-h-full flex-col">
      <SheetHeader className="gap-1 border-b px-6 py-5 pr-14">
        <SheetTitle className="text-title">New booking</SheetTitle>
        <SheetDescription className="text-body-sm text-muted-foreground">
          The customer gets the confirmation email, with a link to manage it.
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-6 px-6 py-6">
        {formError && (
          <p
            role="alert"
            className="rounded-lg bg-danger-soft px-4 py-3 text-body-sm text-danger-text"
          >
            {formError}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-service`} className="text-label">
            Service
          </Label>
          <NativeSelect
            id={`${id}-service`}
            value={serviceId}
            onChange={(event) => {
              setServiceId(event.target.value);
              setSlot(null);
              setTimeError(null);
            }}
          >
            {options.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {formatDuration(s.durationMin)} · {formatPrice(s.priceCents, currency)}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-staff`} className="text-label">
              With
            </Label>
            <NativeSelect
              id={`${id}-staff`}
              value={staffId}
              disabled={staffOnly}
              onChange={(event) => {
                setStaffChoice(event.target.value);
                setSlot(null);
              }}
            >
              {!staffOnly && <option value="any">Anyone available</option>}
              {offering.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-date`} className="text-label">
              Date
            </Label>
            <Input
              id={`${id}-date`}
              type="date"
              required
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setSlot(null);
                setWanted(null);
                setTimeError(null);
              }}
              className="h-11 px-3 font-mono text-body tabular-nums md:text-body"
            />
          </div>
        </div>

        {offering.length === 0 && !staffOnly ? (
          <p className="text-body-sm text-muted-foreground">
            Nobody offers {service?.name ?? "this service"} yet. Assign it on the Staff page.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {missedWanted && (
              <p className="text-body-sm text-muted-foreground">
                <span className="font-mono tabular-nums">{wanted}</span> isn&rsquo;t free for{" "}
                {service?.name ?? "this service"}. Pick another time.
              </p>
            )}
            <TimeChips
              name={`${id}-time`}
              legend="Time"
              state={slots}
              value={chosen?.start ?? null}
              onChange={(next) => {
                setSlot(next);
                setTimeError(null);
              }}
              staffNames={staffId === "any" ? staffNames : undefined}
              emptyText="No free times that day. Try another date or person."
            />
            {timeError && (
              <p role="alert" className="text-body-sm text-danger-text">
                {timeError}
              </p>
            )}
          </div>
        )}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-label">Customer</legend>
          {customer.mode === "search" && (
            <CustomerSearch onPick={pick} onNew={startNew} error={customerError} />
          )}
          {customer.mode === "picked" && (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate text-label">{customer.match.name}</span>
                <span className="block truncate text-body-sm text-muted-foreground">
                  {customer.match.email}
                  {customer.match.phone && ` · ${customer.match.phone}`}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                className="h-11 px-3 text-label"
                onClick={() => setCustomer({ mode: "search" })}
              >
                Change<span className="sr-only"> customer</span>
              </Button>
            </div>
          )}
          {customer.mode === "new" && (
            <div className="flex flex-col gap-4">
              <Field id={`${id}-name`} label="Name" error={errors.name?.message}>
                <Input
                  id={`${id}-name`}
                  autoComplete="off"
                  aria-invalid={!!errors.name || undefined}
                  aria-describedby={errors.name ? `${id}-name-error` : undefined}
                  className="h-11 px-3 text-body md:text-body"
                  {...register("name")}
                />
              </Field>
              <Field id={`${id}-email`} label="Email" error={errors.email?.message}>
                <Input
                  id={`${id}-email`}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  aria-invalid={!!errors.email || undefined}
                  aria-describedby={errors.email ? `${id}-email-error` : undefined}
                  className="h-11 px-3 text-body md:text-body"
                  {...register("email")}
                />
              </Field>
              <Field id={`${id}-phone`} label="Phone" optional error={errors.phone?.message}>
                <Input
                  id={`${id}-phone`}
                  type="tel"
                  autoComplete="off"
                  className="h-11 px-3 text-body md:text-body"
                  {...register("phone")}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-fit px-3 text-label"
                onClick={() => setCustomer({ mode: "search" })}
              >
                Search existing customers instead
              </Button>
            </div>
          )}
        </fieldset>

        <Field id={`${id}-notes`} label="Notes" optional error={errors.notes?.message}>
          <Textarea
            id={`${id}-notes`}
            rows={3}
            aria-describedby={`${id}-notes-hint`}
            className="px-3 text-body md:text-body"
            {...register("notes")}
          />
          <p id={`${id}-notes-hint`} className="text-body-sm text-muted-foreground">
            Shown on the booking and in the customer&rsquo;s emails.
          </p>
        </Field>
      </div>

      <div className="sticky bottom-0 flex justify-end gap-3 border-t bg-card px-6 py-4">
        <Button type="button" variant="secondary" onClick={onDone} className="h-11 px-5 text-label">
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="h-11 px-5 text-label">
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Book appointment
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  optional,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id} className="text-label">
          {label}
        </Label>
        {optional && <span className="text-body-sm text-muted-foreground">Optional</span>}
      </div>
      {children}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/** Find a customer by name or email, or start a new one from what was typed. */
function CustomerSearch({
  onPick,
  onNew,
  error,
}: {
  onPick: (match: CustomerMatch) => void;
  onNew: (query: string) => void;
  error: string | null;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; matches: CustomerMatch[] } | null>(null);
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      searchCustomersAction(term)
        .then((matches) => live && setFound({ query: term, matches }))
        .catch(() => live && setFound({ query: term, matches: [] }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);

  const current = found && found.query === term ? found.matches : null;
  const searching = term.length >= 2 && current === null;

  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor={`${id}-q`} className="sr-only">
        Find a customer
      </Label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={`${id}-q`}
          type="search"
          autoComplete="off"
          placeholder="Search by name or email"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-error` : `${id}-status`}
          className="h-11 pr-3 pl-9 text-body md:text-body"
        />
      </div>
      <p id={`${id}-status`} aria-live="polite" className="sr-only">
        {current
          ? `${current.length} ${current.length === 1 ? "customer" : "customers"} found`
          : ""}
      </p>
      {error && (
        <p id={`${id}-error`} className="text-body-sm text-danger-text">
          {error}
        </p>
      )}
      {searching && <p className="text-body-sm text-muted-foreground">Searching…</p>}
      {current && current.length > 0 && (
        <ul aria-label="Matching customers" className="flex flex-col divide-y rounded-lg border">
          {current.map((match) => (
            <li key={match.id}>
              <button
                type="button"
                onClick={() => onPick(match)}
                className={cn(
                  "flex min-h-12 w-full flex-col px-4 py-2 text-left hover:bg-muted",
                  "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                )}
              >
                <span className="text-label">{match.name}</span>
                <span className="text-body-sm text-muted-foreground">{match.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {current && current.length === 0 && (
        <p className="text-body-sm text-muted-foreground">
          No customers match &ldquo;{term}&rdquo;.
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        className="h-11 w-fit px-4 text-label"
        onClick={() => onNew(term)}
      >
        <UserPlus aria-hidden />
        New customer
      </Button>
    </div>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarDays, User } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { FieldError } from "@/components/onboarding/step-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCustomerTimeZone } from "@/hooks/use-customer-time-zone";
import {
  type BookingState,
  bookingHref,
  cancellationPolicy,
  type PublicBusinessProfile,
  type PublicService,
} from "@/lib/booking-page";
import { formatPrice } from "@/lib/money";
import type { Result } from "@/lib/result";
import {
  type DetailsFormInput,
  type DetailsFormValues,
  detailsFormSchema,
} from "@/lib/validation/booking";

import { LocalRange, LocalTime } from "./local-time";
import { rememberManageToken } from "./manage-link";
import { Policy, StepLayout, StepProgress, SummaryCard } from "./booking-layout";
import { bookingSource } from "./embed-bridge";

type BookAction = (
  slug: string,
  input: unknown,
  /** "widget" inside the website widget's iframe. */
  source?: "page" | "widget",
) => Promise<Result<{ bookingId: string; manageToken: string }, string>>;

/** Step 4: who's coming, then Confirm (docs/design/booking-flow/4-your-details). */
export function DetailsStep({
  slug,
  business,
  service,
  withWhom,
  state,
  book,
}: {
  slug: string;
  business: PublicBusinessProfile;
  service: PublicService;
  withWhom: string;
  state: BookingState & { start: string };
  book: BookAction;
}) {
  const router = useRouter();
  const zone = useCustomerTimeZone();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<DetailsFormInput, unknown, DetailsFormValues>({
    resolver: zodResolver(detailsFormSchema),
    defaultValues: { name: "", email: "", phone: "", notes: "" },
    mode: "onTouched",
  });
  const { register, handleSubmit, formState } = form;
  const errors = formState.errors;

  const formId = useId();
  const ids = {
    name: useId(),
    email: useId(),
    emailHint: useId(),
    phone: useId(),
    phoneHint: useId(),
    notes: useId(),
  };
  const end = new Date(Date.parse(state.start) + service.durationMin * 60_000).toISOString();
  const price = formatPrice(service.priceCents, business.currency);
  const changeHref = bookingHref(slug, { ...state, step: "time", start: null });
  const describedBy = (...parts: (string | false | undefined)[]) =>
    parts.filter(Boolean).join(" ") || undefined;

  const submit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await book(
        slug,
        {
          serviceId: service.id,
          staffId: state.staffId,
          startsAt: state.start,
          customer: { name: values.name, email: values.email, phone: values.phone },
          notes: values.notes,
          customerTimezone: zone ?? undefined,
        },
        bookingSource(),
      );
      if (result.ok) {
        rememberManageToken(result.data.bookingId, result.data.manageToken);
        // Replace, not push: Back from the confirmation must not reopen a
        // form that would book the same time again.
        router.replace(`/b/${slug}/booked/${result.data.bookingId}` as Route);
        return;
      }
      if (result.error.code === "slot_taken" || result.error.code === "slot_unavailable") {
        // Back to the times, showing what happened and the nearest openings.
        router.push(bookingHref(slug, { ...state, step: "time", start: null, taken: state.start }));
        return;
      }
      setFormError(result.error.message);
    });
  });

  const summaryRows = [
    { label: "Service", value: service.name },
    { label: "With", value: withWhom },
    { label: "Date", value: <LocalTime value={state.start} pattern="EEE d MMM" placeholder="…" /> },
    { label: "Time", value: <LocalRange start={state.start} end={end} /> },
  ];

  return (
    <StepLayout
      aside={
        <SummaryCard
          rows={summaryRows}
          total={price}
          action={{ label: "Confirm booking", form: formId, pending }}
          policy={cancellationPolicy(business.cancellationWindowHours)}
        />
      }
    >
      <StepProgress step="details" />

      <section
        aria-label="Your booking"
        className="flex flex-col gap-3 rounded-2xl border bg-card p-6 lg:hidden"
      >
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-title">{service.name}</p>
          <p className="font-mono text-title tabular-nums">{price}</p>
        </div>
        <p className="flex items-center gap-3 text-body">
          <CalendarDays aria-hidden className="size-5 text-muted-foreground" />
          <span>
            <LocalTime value={state.start} pattern="EEE d MMM" placeholder="…" /> ·{" "}
            <LocalRange start={state.start} end={end} />
          </span>
        </p>
        <p className="flex items-center gap-3 text-body text-muted-foreground">
          <User aria-hidden className="size-5" />
          {withWhom}
        </p>
        <Link
          href={changeHref}
          className="mt-2 w-fit text-label underline underline-offset-4 hover:no-underline"
        >
          Change<span className="sr-only"> date and time</span>
        </Link>
      </section>

      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-6">
        <h2 className="text-heading">Your details</h2>
        {formError && (
          <p role="alert" className="rounded-xl bg-danger-soft p-4 text-body text-danger-text">
            {formError}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.name} className="text-label">
            Full name
          </Label>
          <Input
            id={ids.name}
            autoComplete="name"
            aria-invalid={!!errors.name || undefined}
            aria-describedby={describedBy(errors.name && `${ids.name}-error`)}
            className="h-12 px-4 text-body md:text-body"
            {...register("name")}
          />
          <FieldError id={`${ids.name}-error`} message={errors.name?.message} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.email} className="text-label">
            Email
          </Label>
          <Input
            id={ids.email}
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            aria-invalid={!!errors.email || undefined}
            aria-describedby={describedBy(ids.emailHint, errors.email && `${ids.email}-error`)}
            className="h-12 px-4 text-body md:text-body"
            {...register("email")}
          />
          <p id={ids.emailHint} className="text-body-sm text-muted-foreground">
            For your booking code and the details of your appointment.
          </p>
          <FieldError id={`${ids.email}-error`} message={errors.email?.message} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor={ids.phone} className="text-label">
              Phone
            </Label>
            <span className="text-body-sm text-muted-foreground">Optional</span>
          </div>
          <Input
            id={ids.phone}
            type="tel"
            autoComplete="tel"
            aria-invalid={!!errors.phone || undefined}
            aria-describedby={describedBy(ids.phoneHint, errors.phone && `${ids.phone}-error`)}
            className="h-12 px-4 text-body md:text-body"
            {...register("phone")}
          />
          <p id={ids.phoneHint} className="text-body-sm text-muted-foreground">
            Only so {business.name} can reach you if they&rsquo;re running late.
          </p>
          <FieldError id={`${ids.phone}-error`} message={errors.phone?.message} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor={ids.notes} className="text-label">
              Notes
            </Label>
            <span className="text-body-sm text-muted-foreground">Optional</span>
          </div>
          <Textarea
            id={ids.notes}
            rows={4}
            placeholder="Anything we should know, like allergies or the look you're after"
            aria-invalid={!!errors.notes || undefined}
            aria-describedby={describedBy(errors.notes && `${ids.notes}-error`)}
            className="min-h-28 px-4 py-3 text-body md:text-body"
            {...register("notes")}
          />
          <FieldError id={`${ids.notes}-error`} message={errors.notes?.message} />
        </div>

        <div className="flex flex-col gap-4 lg:hidden">
          <Policy text={cancellationPolicy(business.cancellationWindowHours)} />
          <Button type="submit" disabled={pending} className="h-12 w-full text-label">
            {pending ? "Booking…" : "Confirm booking"}
          </Button>
        </div>
      </form>
    </StepLayout>
  );
}

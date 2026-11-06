"use client";

import { TZDate } from "@date-fns/tz";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { AlertTriangle, Loader2, Undo2 } from "lucide-react";
import { type ReactNode, useId, useState, useTransition } from "react";
import { type FieldPath, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { FieldError } from "@/components/onboarding/step-footer";
import { BrandColorField, LogoField } from "@/components/shared/brand-fields";
import { NativeSelect } from "@/components/shared/native-select";
import { SlugField, useSlugStatus } from "@/components/shared/slug-field";
import { dayErrorMessages, WeekEditor } from "@/components/shared/week-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type DayHours,
  defaultWeek,
  isOnGrid,
  openingWeek,
  roundRangeInward,
  roundWeekInward,
  WEEKDAY_NAMES,
  weekOnGrid,
} from "@/lib/hours";
import { cn } from "@/lib/utils";
import {
  type BusinessSettingsInput,
  businessSettingsSchema,
  type BusinessSettingsValues,
  CANCELLATION_OPTIONS,
  formatCancellation,
  formatNotice,
  MAX_DAYS_AHEAD,
  NOTICE_OPTIONS,
  SLOT_INTERVALS,
} from "@/lib/validation/settings";
import type { BusinessSettingsRow, StaffRange } from "@/server/db/queries/settings";

import { checkSettingsSlugAction, saveBusinessSettingsAction } from "./actions";

type Option = { value: string; label: string };

type Props = {
  settings: BusinessSettingsRow;
  staffRanges: StaffRange[];
  upcoming: { bookings: number; timeOff: number };
  timeZones: Option[];
  currencies: Option[];
  host: string;
  /** ISO: the timezone warning's example uses today. */
  now: string;
};

function initialValues(settings: BusinessSettingsRow): BusinessSettingsInput {
  return {
    name: settings.name,
    slug: settings.slug,
    timezone: settings.timezone,
    currency: settings.currency,
    brandColor: settings.brandColor,
    logoUrl: settings.logoUrl,
    openingHours: openingWeek(settings.openingHours) ?? defaultWeek(),
    rules: {
      minNoticeMin: settings.minNoticeMin,
      maxDaysAhead: settings.maxDaysAhead,
      slotIntervalMin: settings.slotIntervalMin,
      cancellationWindowHours: settings.cancellationWindowHours,
    },
    roundStaffHours: false,
    confirmTimezone: false,
  };
}

/** Settings → Business for owners: one form, saved together. */
export function BusinessForm({
  now,
  settings,
  staffRanges,
  upcoming,
  timeZones,
  currencies,
  host,
}: Props) {
  const form = useForm<BusinessSettingsInput, unknown, BusinessSettingsValues>({
    resolver: zodResolver(businessSettingsSchema),
    defaultValues: initialValues(settings),
    mode: "onTouched",
  });
  const { register, setValue, control, formState, setError, clearErrors, reset } = form;
  const [pending, startTransition] = useTransition();

  const [name, slug, timezone, currency, brandColor, logoUrl, openingHours, rules, rounding] =
    useWatch({
      control,
      name: [
        "name",
        "slug",
        "timezone",
        "currency",
        "brandColor",
        "logoUrl",
        "openingHours",
        "rules",
        "roundStaffHours",
      ],
    });
  const days = openingHours as DayHours[];
  const interval = Number(rules.slotIntervalMin);
  const confirmTimezone = useWatch({ control, name: "confirmTimezone" });

  const slugStatus = useSlugStatus(slug, checkSettingsSlugAction, settings.slug);
  const timezoneChanged = timezone !== settings.timezone;
  const slugChanged = slug.trim().toLowerCase() !== settings.slug;

  // Hours that a 30-minute grid would leave stranded.
  const staffOffGrid = staffRanges.filter(
    (r) => !isOnGrid(r.start, interval) || !isOnGrid(r.end, interval),
  );
  const openingOffGrid = !weekOnGrid(days, interval);
  const [beforeRounding, setBeforeRounding] = useState<DayHours[] | null>(null);

  function roundToGrid() {
    setBeforeRounding(days);
    setValue("openingHours", roundWeekInward(days, interval), {
      shouldDirty: true,
      shouldValidate: formState.isSubmitted,
    });
    setValue("roundStaffHours", true, { shouldDirty: true });
    clearErrors("root");
  }

  function undoRounding() {
    if (beforeRounding) setValue("openingHours", beforeRounding, { shouldDirty: true });
    setBeforeRounding(null);
    setValue("roundStaffHours", false);
  }

  const ids = {
    name: useId(),
    nameError: useId(),
    slug: useId(),
    slugStatus: useId(),
    slugWarning: useId(),
    timezone: useId(),
    timezoneError: useId(),
    currency: useId(),
    currencyHint: useId(),
    hex: useId(),
    hexError: useId(),
    contrast: useId(),
    logoHelp: useId(),
    notice: useId(),
    noticeHint: useId(),
    maxDays: useId(),
    maxDaysHint: useId(),
    maxDaysError: useId(),
    intervalHint: useId(),
    cancellation: useId(),
    cancellationHint: useId(),
    confirmTimezone: useId(),
  };

  const onSubmit = form.handleSubmit((values) => {
    if (timezoneChanged && !values.confirmTimezone) {
      setError("confirmTimezone", { message: "Confirm the timezone change to save." });
      document.getElementById(ids.confirmTimezone)?.focus();
      return;
    }
    if (staffOffGrid.length > 0 && !values.roundStaffHours) {
      setError("root", {
        message: `Some staff hours aren't on the ${interval}-minute grid. Round them or change them on the Staff page first.`,
      });
      return;
    }
    startTransition(async () => {
      const result = await saveBusinessSettingsAction(values);
      if (!result.ok) {
        const fields = Object.entries(result.error.fieldErrors ?? {});
        for (const [field, messages] of fields) {
          setError(field as FieldPath<BusinessSettingsInput>, { message: messages[0] });
        }
        if (fields.length === 0) setError("root", { message: result.error.message });
        return;
      }
      const { slugChanged: movedLink, roundedRanges, movedTimeOff } = result.data;
      const notes = [
        movedLink && `Your booking link is now ${host}/b/${values.slug}.`,
        roundedRanges > 0 &&
          `Rounded ${roundedRanges} staff ${roundedRanges === 1 ? "range" : "ranges"} to the grid.`,
        movedTimeOff > 0 &&
          `Moved ${movedTimeOff} time off ${movedTimeOff === 1 ? "entry" : "entries"} to the new timezone.`,
      ].filter(Boolean);
      toast.success("Settings saved", { description: notes.join(" ") || undefined });
      setBeforeRounding(null);
      reset({ ...values, roundStaffHours: false, confirmTimezone: false });
    });
  });

  const errors = formState.errors;
  const dayErrors = dayErrorMessages(errors.openingHours, days.length);
  const formError = errors.root?.message ?? dayErrors.week;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      <Section
        title="Business"
        description="Your name and booking link appear on your booking page, emails and the widget."
      >
        <Field>
          <Label htmlFor={ids.name} className="text-label">
            Business name
          </Label>
          <Input
            id={ids.name}
            autoComplete="organization"
            aria-invalid={!!errors.name || undefined}
            aria-describedby={errors.name ? ids.nameError : undefined}
            className="h-11 px-3 text-body md:text-body"
            {...register("name")}
          />
          <FieldError id={ids.nameError} message={errors.name?.message} />
        </Field>

        <Field>
          <Label htmlFor={ids.slug} className="text-label">
            Booking link
          </Label>
          <SlugField
            id={ids.slug}
            statusId={ids.slugStatus}
            host={host}
            status={slugStatus}
            error={errors.slug?.message}
            inputProps={register("slug")}
            describedBy={slugChanged ? ids.slugWarning : undefined}
          />
          {slugChanged && (
            <Warning id={ids.slugWarning} title="Old links will stop working">
              <p>
                <span className="font-mono text-mono break-all">
                  {host}/b/{settings.slug}
                </span>{" "}
                won&rsquo;t open your booking page any more. Update your website, embed code, social
                profiles, QR codes and anything printed.
              </p>
            </Warning>
          )}
        </Field>

        <div className="grid gap-6 md:grid-cols-2">
          <Field>
            <Label htmlFor={ids.timezone} className="text-label">
              Timezone
            </Label>
            <NativeSelect
              id={ids.timezone}
              aria-invalid={!!errors.timezone || undefined}
              aria-describedby={errors.timezone ? ids.timezoneError : undefined}
              {...register("timezone", {
                onChange: () => setValue("confirmTimezone", false),
              })}
            >
              {timeZones.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </NativeSelect>
            <FieldError id={ids.timezoneError} message={errors.timezone?.message} />
          </Field>

          <Field>
            <Label htmlFor={ids.currency} className="text-label">
              Currency
            </Label>
            <NativeSelect
              id={ids.currency}
              aria-describedby={ids.currencyHint}
              aria-invalid={!!errors.currency || undefined}
              {...register("currency")}
            >
              {currencies.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
            <p
              id={ids.currencyHint}
              className={cn(
                "text-body-sm",
                currency !== settings.currency ? "text-warning-text" : "text-muted-foreground",
              )}
            >
              {errors.currency?.message ??
                (currency !== settings.currency
                  ? "Prices aren't converted: check your services after saving."
                  : "Used for every price on your booking page.")}
            </p>
          </Field>
        </div>

        {timezoneChanged && (
          <TimezoneWarning
            now={now}
            from={settings.timezone}
            to={timezone}
            upcoming={upcoming}
            checkbox={
              <div className="flex flex-col gap-1">
                <div className="flex min-h-11 items-center gap-3">
                  <Checkbox
                    id={ids.confirmTimezone}
                    checked={confirmTimezone}
                    aria-invalid={!!errors.confirmTimezone || undefined}
                    onCheckedChange={(checked) => {
                      setValue("confirmTimezone", checked === true);
                      clearErrors("confirmTimezone");
                    }}
                    className="size-5"
                  />
                  <Label htmlFor={ids.confirmTimezone} className="text-label text-foreground">
                    Change the timezone anyway
                  </Label>
                </div>
                {errors.confirmTimezone && (
                  <p className="text-body-sm text-danger-text">{errors.confirmTimezone.message}</p>
                )}
              </div>
            }
          />
        )}
      </Section>

      <Section
        title="Brand"
        description="Your logo and colour appear on your booking page, emails and the widget."
      >
        <LogoField
          businessId={settings.id}
          name={name}
          logoUrl={logoUrl}
          error={errors.logoUrl?.message}
          helpId={ids.logoHelp}
          onChange={(url) => setValue("logoUrl", url, { shouldDirty: true, shouldValidate: true })}
        />
        <BrandColorField
          color={brandColor}
          onPick={(hex) => setValue("brandColor", hex, { shouldDirty: true, shouldValidate: true })}
          hexProps={register("brandColor", {
            setValueAs: (value: string) => (value.startsWith("#") ? value : `#${value}`),
          })}
          error={errors.brandColor?.message}
          ids={ids}
        />
      </Section>

      <Section
        title="Opening hours"
        description={
          <>
            Shown on your booking page. Customers book each person&rsquo;s own hours (Staff page);
            hours outside these get a warning there.
            {!settings.openingHours && " Not set yet: these are suggestions until you save."}
          </>
        }
      >
        <WeekEditor
          days={days}
          intervalMin={interval}
          errors={dayErrors.days}
          disabled={pending}
          onChange={(next) =>
            setValue("openingHours", next, {
              shouldDirty: true,
              shouldValidate: formState.isSubmitted,
            })
          }
        />
      </Section>

      <Section
        title="Booking rules"
        description="When customers can book, and until when they can cancel online."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <Field>
            <Label htmlFor={ids.notice} className="text-label">
              Minimum notice
            </Label>
            <NativeSelect
              id={ids.notice}
              aria-describedby={ids.noticeHint}
              {...register("rules.minNoticeMin", { setValueAs: Number })}
            >
              {withCurrent(NOTICE_OPTIONS, settings.minNoticeMin).map((minutes) => (
                <option key={minutes} value={minutes}>
                  {formatNotice(minutes)}
                </option>
              ))}
            </NativeSelect>
            <p id={ids.noticeHint} className="text-body-sm text-muted-foreground">
              How soon before a time customers can still book it.
            </p>
          </Field>

          <Field>
            <Label htmlFor={ids.maxDays} className="text-label">
              Book up to
            </Label>
            <div className="flex items-center gap-3">
              <Input
                id={ids.maxDays}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_DAYS_AHEAD}
                step={1}
                aria-invalid={!!errors.rules?.maxDaysAhead || undefined}
                aria-describedby={`${ids.maxDaysHint} ${errors.rules?.maxDaysAhead ? ids.maxDaysError : ""}`}
                className="h-11 w-28 px-3 font-mono text-mono tabular-nums md:text-mono"
                {...register("rules.maxDaysAhead", {
                  setValueAs: (v: string) => (v === "" ? "" : Number(v)),
                })}
              />
              <span className="text-body text-muted-foreground">days ahead</span>
            </div>
            <FieldError id={ids.maxDaysError} message={errors.rules?.maxDaysAhead?.message} />
            <p id={ids.maxDaysHint} className="text-body-sm text-muted-foreground">
              How far ahead customers can book, up to {MAX_DAYS_AHEAD} days.
            </p>
          </Field>

          <fieldset className="flex flex-col gap-2" aria-describedby={ids.intervalHint}>
            <legend className="mb-2 text-label">Time slots</legend>
            <div className="inline-flex w-fit rounded-lg border bg-background p-1">
              {SLOT_INTERVALS.map((minutes) => (
                <label key={minutes} className="relative">
                  <input
                    type="radio"
                    name="slot-interval"
                    value={minutes}
                    checked={interval === minutes}
                    disabled={pending}
                    onChange={() =>
                      setValue("rules.slotIntervalMin", minutes, {
                        shouldDirty: true,
                        shouldValidate: formState.isSubmitted,
                      })
                    }
                    className="peer sr-only"
                  />
                  <span className="flex h-11 cursor-pointer items-center rounded-md px-4 text-label text-muted-foreground peer-checked:bg-primary-tint peer-checked:text-primary-tint-foreground peer-focus-visible:outline-3 peer-focus-visible:outline-ring">
                    Every {minutes} minutes
                  </span>
                </label>
              ))}
            </div>
            <p id={ids.intervalHint} className="text-body-sm text-muted-foreground">
              Start times customers can pick, and the grid staff hours sit on.
            </p>
          </fieldset>

          <Field>
            <Label htmlFor={ids.cancellation} className="text-label">
              Free cancellation
            </Label>
            <NativeSelect
              id={ids.cancellation}
              aria-describedby={ids.cancellationHint}
              {...register("rules.cancellationWindowHours", { setValueAs: Number })}
            >
              {withCurrent(CANCELLATION_OPTIONS, settings.cancellationWindowHours).map((hours) => (
                <option key={hours} value={hours}>
                  {formatCancellation(hours)}
                </option>
              ))}
            </NativeSelect>
            <p id={ids.cancellationHint} className="text-body-sm text-muted-foreground">
              Until then customers can cancel or reschedule online. After that, they contact you.
            </p>
          </Field>
        </div>

        {(staffOffGrid.length > 0 || openingOffGrid) && (
          <GridWarning
            interval={interval}
            staffOffGrid={staffOffGrid}
            openingOffDays={openingOffGrid ? offGridDays(days, interval) : []}
            rounding={rounding}
            onRound={roundToGrid}
            onUndo={undoRounding}
          />
        )}
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-6">
        {formError && (
          <p role="alert" className="mr-auto text-body-sm text-danger-text">
            {formError}
          </p>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={!formState.isDirty || pending}
          onClick={() => {
            setBeforeRounding(null);
            reset(initialValues(settings));
          }}
          className="h-11 px-4 text-label"
        >
          Discard changes
        </Button>
        <Button type="submit" disabled={pending} className="h-11 px-5 text-label">
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Save changes
        </Button>
      </div>
    </form>
  );
}

/** Option lists plus a saved value that isn't one of them. */
const withCurrent = (options: readonly number[], current: number) =>
  options.includes(current) ? options : [...options, current].sort((a, b) => a - b);

function offGridDays(days: DayHours[], interval: number) {
  return days
    .filter(
      (day) =>
        day.open &&
        day.ranges.some((r) => !isOnGrid(r.start, interval) || !isOnGrid(r.end, interval)),
    )
    .map((day) => WEEKDAY_NAMES[day.weekday] ?? "");
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-6 rounded-xl border bg-card p-5 sm:p-8"
    >
      <div>
        <h2 id={id} className="text-title">
          {title}
        </h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

const Field = ({ children }: { children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-2">{children}</div>
);

function Warning({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <div
      id={id}
      className="flex items-start gap-3 rounded-lg bg-warning-soft px-4 py-3 text-body-sm text-warning-text"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </div>
  );
}

function TimezoneWarning({
  now,
  from,
  to,
  upcoming,
  checkbox,
}: {
  now: string;
  from: string;
  to: string;
  upcoming: { bookings: number; timeOff: number };
  checkbox: ReactNode;
}) {
  const city = (zone: string) => zone.split("/").pop()!.replaceAll("_", " ");
  // A 10:00 booking today in the old zone, read in the new one.
  const today = new TZDate(new Date(now).getTime(), from);
  const example = new TZDate(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0, from);
  const there = format(new TZDate(example.getTime(), to), "HH:mm");

  return (
    <Warning title={`Changing the timezone from ${city(from)} to ${city(to)}`}>
      <ul className="flex list-disc flex-col gap-1 pl-4">
        <li>
          Opening and staff hours keep their clock times: 09:00 stays 09:00, in {city(to)} time.
        </li>
        {upcoming.timeOff > 0 && (
          <li>
            Upcoming time off ({upcoming.timeOff}) moves with them, to the same dates and times.
          </li>
        )}
        <li>
          {upcoming.bookings > 0 ? `Upcoming bookings (${upcoming.bookings})` : "Bookings"} keep
          their exact time, so they show at new local times: 10:00 in {city(from)} is{" "}
          <span className="font-mono text-mono tabular-nums">{there}</span> in {city(to)}.
        </li>
      </ul>
      {checkbox}
    </Warning>
  );
}

function GridWarning({
  interval,
  staffOffGrid,
  openingOffDays,
  rounding,
  onRound,
  onUndo,
}: {
  interval: number;
  staffOffGrid: StaffRange[];
  openingOffDays: string[];
  rounding: boolean;
  onRound: () => void;
  onUndo: () => void;
}) {
  const nothingLeft = (r: StaffRange) => roundRangeInward(r, interval) === null;
  return (
    <Warning
      title={
        rounding
          ? `Hours will be rounded to the ${interval}-minute grid when you save`
          : `Some hours aren't on the ${interval}-minute grid`
      }
    >
      {openingOffDays.length > 0 && <p>Opening hours: {openingOffDays.join(", ")}.</p>}
      {staffOffGrid.length > 0 && (
        <ul aria-label="Staff hours off the grid" className="flex flex-col gap-1">
          {staffOffGrid.map((r) => {
            const next = roundRangeInward(r, interval);
            return (
              <li key={r.id}>
                {r.staffName} · {WEEKDAY_NAMES[r.weekday]}{" "}
                <span className="font-mono text-mono tabular-nums">
                  {r.start} – {r.end}
                </span>
                {rounding && (
                  <>
                    {" → "}
                    {next ? (
                      <span className="font-mono text-mono tabular-nums">
                        {next.start} – {next.end}
                      </span>
                    ) : (
                      "removed"
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p>
        {rounding
          ? "Starts move later and ends earlier, so nobody is booked outside the hours they set."
          : `Customers can only book on the grid. Round these hours (starts later, ends earlier), or change them first.${
              staffOffGrid.some(nothingLeft) ? " Ranges too short for the grid are removed." : ""
            }`}
      </p>
      <div>
        {rounding ? (
          <Button
            type="button"
            variant="secondary"
            onClick={onUndo}
            className="h-11 px-4 text-label"
          >
            <Undo2 aria-hidden />
            Don&rsquo;t round
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={onRound}
            className="h-11 px-4 text-label"
          >
            Round to the {interval}-minute grid
          </Button>
        )}
      </div>
    </Warning>
  );
}

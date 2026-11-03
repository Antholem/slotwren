"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Plus, X } from "lucide-react";
import { useState } from "react";
import { type FieldErrors, useForm, useWatch } from "react-hook-form";

import { BookingPreview, type PreviewProps } from "@/components/onboarding/booking-preview";
import { StepFooter } from "@/components/onboarding/step-footer";
import { STEP_FORM_ID, StepShell } from "@/components/onboarding/step-shell";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  type DayHours,
  HALF_HOURS,
  MAX_RANGES_PER_DAY,
  minutesOf,
  openingSummary,
  summarizeWeek,
  type TimeRange,
  WEEKDAY_NAMES,
} from "@/lib/hours";
import { cn } from "@/lib/utils";
import { type HoursInput, hoursSchema } from "@/lib/validation/onboarding";

import { saveHoursAction } from "../actions";
import { useStepSubmit } from "../use-step-submit";

type Props = { initial: { days: DayHours[] }; preview: PreviewProps };

const LAST = HALF_HOURS[HALF_HOURS.length - 1]!;

/** A sensible next range after `last`: starts when it ends, two hours long. */
function rangeAfter(last: TimeRange | undefined): TimeRange | null {
  if (!last) return { start: "09:00", end: "17:00" };
  const start = HALF_HOURS.indexOf(last.end);
  if (start < 0 || last.end === LAST) return null;
  return { start: last.end, end: HALF_HOURS[Math.min(start + 4, HALF_HOURS.length - 1)]! };
}

export function HoursForm({ initial, preview }: Props) {
  const form = useForm<HoursInput>({
    resolver: zodResolver(hoursSchema),
    defaultValues: initial,
  });
  const { control, setValue, formState } = form;
  const { onSubmit, pending, formError } = useStepSubmit(form, saveHoursAction);
  const days = useWatch({ control, name: "days" }) as DayHours[];
  const [announcement, setAnnouncement] = useState("");

  function update(index: number, change: (day: DayHours) => DayHours) {
    const next = days.map((day, i) => (i === index ? change(day) : day));
    setValue("days", next, { shouldDirty: true, shouldValidate: formState.isSubmitted });
  }

  function copyToOpenDays(index: number) {
    const source = days[index]!;
    let count = 0;
    const next = days.map((day, i) => {
      if (i === index || !day.open) return day;
      count += 1;
      return { ...day, ranges: source.ranges.map((r) => ({ ...r })) };
    });
    setValue("days", next, { shouldDirty: true, shouldValidate: formState.isSubmitted });
    setAnnouncement(
      count === 0
        ? "No other open days to copy to. Open a day first."
        : `Copied ${WEEKDAY_NAMES[source.weekday]}'s hours to ${count} other open ${count === 1 ? "day" : "days"}.`,
    );
  }

  const firstOpen = days.findIndex((day) => day.open);
  const dayErrors = formState.errors.days as FieldErrors<DayHours[]> & {
    root?: { message?: string };
    message?: string;
  };
  const weekError = dayErrors?.root?.message ?? dayErrors?.message ?? formError;

  return (
    <StepShell
      step={4}
      title="When are you open?"
      description="Customers can only book inside these hours. Times start on the half hour."
      preview={<BookingPreview {...preview} hoursLabel={openingSummary(days)} />}
    >
      <form id={STEP_FORM_ID} noValidate onSubmit={onSubmit}>
        <ul className="divide-y border-y">
          {days.map((day, index) => {
            const name = WEEKDAY_NAMES[day.weekday];
            const error = dayErrors?.[index];
            const rangeError =
              error?.ranges?.message ??
              (error?.ranges as { root?: { message?: string } } | undefined)?.root?.message ??
              (Array.isArray(error?.ranges)
                ? error.ranges.find((r) => r?.end?.message)?.end?.message
                : undefined);
            const addable = day.ranges.length < MAX_RANGES_PER_DAY && rangeAfter(day.ranges.at(-1));

            return (
              <li
                key={day.weekday}
                className="flex flex-col gap-3 py-5 sm:flex-row sm:items-start sm:gap-4"
              >
                <div className="flex min-h-11 items-center gap-4 sm:w-44 sm:shrink-0">
                  <span className="w-24 shrink-0 text-label">{name}</span>
                  <Switch
                    size="lg"
                    checked={day.open}
                    onCheckedChange={(open) => update(index, (d) => ({ ...d, open }))}
                    aria-label={`Open on ${name}`}
                  />
                  {!day.open && <span className="text-body text-muted-foreground">Closed</span>}
                </div>

                {day.open && (
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    {day.ranges.map((range, r) => {
                      const isLast = r === day.ranges.length - 1;
                      const suffix = day.ranges.length > 1 ? ` (range ${r + 1})` : "";
                      return (
                        <div key={r} className="flex flex-wrap items-center gap-2">
                          <TimeSelect
                            label={`${name} opens${suffix}`}
                            value={range.start}
                            onChange={(start) =>
                              update(index, (d) => ({
                                ...d,
                                ranges: d.ranges.map((x, i) => (i === r ? { ...x, start } : x)),
                              }))
                            }
                          />
                          <span aria-hidden className="text-muted-foreground">
                            –
                          </span>
                          <TimeSelect
                            label={`${name} closes${suffix}`}
                            value={range.end}
                            invalid={minutesOf(range.end) <= minutesOf(range.start)}
                            onChange={(end) =>
                              update(index, (d) => ({
                                ...d,
                                ranges: d.ranges.map((x, i) => (i === r ? { ...x, end } : x)),
                              }))
                            }
                          />
                          {day.ranges.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-11"
                              aria-label={`Remove ${name} hours ${prettyRange(range)}`}
                              onClick={() =>
                                update(index, (d) => ({
                                  ...d,
                                  ranges: d.ranges.filter((_, i) => i !== r),
                                }))
                              }
                            >
                              <X aria-hidden />
                            </Button>
                          )}
                          {isLast && addable && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-11"
                              aria-label={`Add more hours on ${name}`}
                              onClick={() =>
                                update(index, (d) => ({
                                  ...d,
                                  ranges: [...d.ranges, rangeAfter(d.ranges.at(-1))!],
                                }))
                              }
                            >
                              <Plus aria-hidden />
                            </Button>
                          )}
                          {r === 0 && index === firstOpen && (
                            <CopyButton
                              className="ml-auto hidden lg:flex"
                              onClick={() => copyToOpenDays(index)}
                            />
                          )}
                        </div>
                      );
                    })}
                    {index === firstOpen && (
                      <CopyButton
                        className="self-start lg:hidden"
                        onClick={() => copyToOpenDays(index)}
                      />
                    )}
                    {rangeError && <p className="text-body-sm text-danger-text">{rangeError}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <p className="mt-6 text-body-sm text-muted-foreground">{summarizeWeek(days)}</p>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
        {weekError && (
          <p role="alert" className="mt-3 text-body-sm text-danger-text">
            {weekError}
          </p>
        )}

        <StepFooter back="/onboarding/service" submitLabel="Finish and go live" pending={pending} />
      </form>
    </StepShell>
  );
}

function CopyButton({ className, onClick }: { className?: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="secondary"
      className={cn("h-11 px-4 text-label", className)}
      onClick={onClick}
    >
      <Copy aria-hidden />
      Copy to all days
    </Button>
  );
}

function prettyRange(range: TimeRange) {
  return `${range.start} to ${range.end}`;
}

function TimeSelect({
  label,
  value,
  invalid,
  onChange,
}: {
  label: string;
  value: string;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <NativeSelect
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-28 [&_select]:font-mono [&_select]:tabular-nums"
    >
      {HALF_HOURS.map((time) => (
        <option key={time} value={time}>
          {time}
        </option>
      ))}
    </NativeSelect>
  );
}

"use client";

import { Copy, Plus, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  type DayHours,
  dayMinutes,
  formatDuration,
  MAX_RANGES_PER_DAY,
  minutesOf,
  type TimeRange,
  timeOptions,
  WEEKDAY_NAMES,
} from "@/lib/hours";
import { cn } from "@/lib/utils";

type Props = {
  days: DayHours[];
  onChange: (days: DayHours[]) => void;
  /** The business's slot grid: 15 or 30 minutes. */
  intervalMin?: number;
  /** Validation message per day, by index. */
  errors?: (string | undefined)[];
  /** Switch label for a day: "Open on Monday", "Aiko works Monday". */
  switchLabel?: (day: string) => string;
  closedLabel?: string;
  /** Words in the time selects' labels: "Monday opens" / "Monday starts". */
  verbs?: { start: string; end: string };
  /** Extra context beside a day's name, e.g. "Studio closed". */
  dayNote?: (weekday: number) => ReactNode;
  /** Show each day's total ("9 h"). */
  showTotals?: boolean;
  /** Narrow containers (a side sheet): ranges always sit under the day. */
  stacked?: boolean;
  disabled?: boolean;
};

/**
 * Weekly hours, one row per weekday (Monday first): open/closed toggle,
 * several ranges per day, and "Copy to all days" (to the other open days).
 * Shared by onboarding's "When are you open?" and the staff hours editor.
 */
export function WeekEditor({
  days,
  onChange,
  intervalMin = 30,
  errors,
  switchLabel = (day) => `Open on ${day}`,
  closedLabel = "Closed",
  verbs = { start: "opens", end: "closes" },
  dayNote,
  showTotals = false,
  stacked = false,
  disabled = false,
}: Props) {
  const times = useMemo(() => timeOptions(intervalMin), [intervalMin]);
  const [announcement, setAnnouncement] = useState("");

  /** A sensible next range after `last`: starts when it ends, two hours long. */
  function rangeAfter(last: TimeRange | undefined): TimeRange | null {
    if (!last) return { start: "09:00", end: "17:00" };
    const start = times.indexOf(last.end);
    if (start < 0 || start === times.length - 1) return null;
    return { start: last.end, end: times[Math.min(start + 120 / intervalMin, times.length - 1)]! };
  }

  function update(index: number, change: (day: DayHours) => DayHours) {
    onChange(days.map((day, i) => (i === index ? change(day) : day)));
  }

  function copyToOpenDays(index: number) {
    const source = days[index]!;
    let count = 0;
    onChange(
      days.map((day, i) => {
        if (i === index || !day.open) return day;
        count += 1;
        return { ...day, ranges: source.ranges.map((r) => ({ ...r })) };
      }),
    );
    setAnnouncement(
      count === 0
        ? "No other open days to copy to. Open a day first."
        : `Copied ${WEEKDAY_NAMES[source.weekday]}'s hours to ${count} other open ${count === 1 ? "day" : "days"}.`,
    );
  }

  const firstOpen = days.findIndex((day) => day.open);

  return (
    <>
      <ul className="divide-y border-y">
        {days.map((day, index) => {
          const name = WEEKDAY_NAMES[day.weekday] ?? "";
          const addable = day.ranges.length < MAX_RANGES_PER_DAY && rangeAfter(day.ranges.at(-1));
          const total = dayMinutes(day);

          return (
            <li
              key={day.weekday}
              className={cn(
                "flex flex-col gap-3 py-5",
                !stacked && "sm:flex-row sm:items-start sm:gap-4",
              )}
            >
              <div
                className={cn(
                  "flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1",
                  !stacked && "sm:w-44 sm:shrink-0",
                )}
              >
                <span className="w-24 shrink-0 text-label">{name}</span>
                <Switch
                  size="lg"
                  checked={day.open}
                  disabled={disabled}
                  onCheckedChange={(open) => update(index, (d) => ({ ...d, open }))}
                  aria-label={switchLabel(name)}
                />
                {!day.open && (
                  <span className="text-body text-muted-foreground">{closedLabel}</span>
                )}
                {dayNote?.(day.weekday)}
                {showTotals && day.open && (
                  <span className="ml-auto font-mono text-mono-sm text-muted-foreground tabular-nums">
                    {formatDuration(total)}
                  </span>
                )}
              </div>

              {day.open && (
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  {day.ranges.map((range, r) => {
                    const isLast = r === day.ranges.length - 1;
                    const suffix = day.ranges.length > 1 ? ` (range ${r + 1})` : "";
                    return (
                      <div key={r} className="flex flex-wrap items-center gap-2">
                        <TimeSelect
                          times={times}
                          label={`${name} ${verbs.start}${suffix}`}
                          value={range.start}
                          disabled={disabled}
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
                          times={times}
                          label={`${name} ${verbs.end}${suffix}`}
                          value={range.end}
                          disabled={disabled}
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
                            disabled={disabled}
                            aria-label={`Remove ${name} hours ${range.start} to ${range.end}`}
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
                            disabled={disabled}
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
                        {!stacked && r === 0 && index === firstOpen && (
                          <CopyButton
                            className="ml-auto hidden lg:flex"
                            disabled={disabled}
                            onClick={() => copyToOpenDays(index)}
                          />
                        )}
                      </div>
                    );
                  })}
                  {index === firstOpen && (
                    <CopyButton
                      className={cn("self-start", !stacked && "lg:hidden")}
                      disabled={disabled}
                      onClick={() => copyToOpenDays(index)}
                    />
                  )}
                  {errors?.[index] && (
                    <p className="text-body-sm text-danger-text">{errors[index]}</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

function CopyButton({
  className,
  disabled,
  onClick,
}: {
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={disabled}
      className={cn("h-11 px-4 text-label", className)}
      onClick={onClick}
    >
      <Copy aria-hidden />
      Copy to all days
    </Button>
  );
}

function TimeSelect({
  times,
  label,
  value,
  invalid,
  disabled,
  onChange,
}: {
  times: string[];
  label: string;
  value: string;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  // Keep a saved value selectable even if the grid changed since.
  const options = times.includes(value) ? times : [value, ...times].sort();
  return (
    <NativeSelect
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="w-28 [&_select]:font-mono [&_select]:tabular-nums"
    >
      {options.map((time) => (
        <option key={time} value={time}>
          {time}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Per-day messages from a React Hook Form error tree for `days`. */
export function dayErrorMessages(
  errors: unknown,
  count: number,
): { days: (string | undefined)[]; week: string | undefined } {
  type RangeErrors = { message?: string; root?: { message?: string } } & (
    { end?: { message?: string } } | undefined
  )[];
  const tree = errors as
    | ({ message?: string; root?: { message?: string } } & Record<
        number,
        { ranges?: RangeErrors } | undefined
      >)
    | undefined;
  const days = Array.from({ length: count }, (_, i) => {
    const ranges = tree?.[i]?.ranges;
    return (
      ranges?.message ??
      ranges?.root?.message ??
      (Array.isArray(ranges) ? ranges.find((r) => r?.end?.message)?.end?.message : undefined)
    );
  });
  return { days, week: tree?.root?.message ?? tree?.message };
}

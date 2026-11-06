"use client";

import { AlertTriangle, CalendarDays, Loader2, Plus } from "lucide-react";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { FieldError } from "@/components/onboarding/step-footer";
import { NativeSelect } from "@/components/shared/native-select";
import { WeekEditor } from "@/components/shared/week-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  type DayHours,
  dayMinutes,
  defaultWeek,
  describeOpenDays,
  formatDuration,
  fromAvailabilityRows,
  hoursOutsideOpening,
  type OpeningRange,
  openingWeek,
  sharedHours,
  timeOptions,
  WEEK_ORDER,
  WEEKDAY_NAMES,
  weekSchemaFor,
} from "@/lib/hours";
import {
  timeOffLabel,
  type TimeOffInput,
  timeOffSchemaFor,
  todayIn,
  toTimeOffInput,
} from "@/lib/time-off";
import { cn } from "@/lib/utils";
import type { DashboardStaff } from "@/server/db/queries/staff";

import {
  addTimeOffAction,
  editTimeOffAction,
  removeTimeOffAction,
  saveStaffHoursAction,
} from "./actions";

export type ScheduleContext = {
  timezone: string;
  slotIntervalMin: number;
  openingHours: OpeningRange[] | null;
  /** The request time, from the server, so renders are stable. */
  now: Date;
};

const gridWords = (intervalMin: number) =>
  intervalMin === 30 ? "on the half hour" : `every ${intervalMin} minutes`;

// ── Weekly hours ────────────────────────────────────────────────────────

export function HoursPanel({
  person,
  canEdit,
  context,
}: {
  person: DashboardStaff;
  canEdit: boolean;
  context: ScheduleContext;
}) {
  const opening = useMemo(() => openingWeek(context.openingHours), [context.openingHours]);
  const [days, setDays] = useState<DayHours[]>(() =>
    person.hours.length ? fromAvailabilityRows(person.hours) : (opening ?? defaultWeek()),
  );
  const [errors, setErrors] = useState<{ days: (string | undefined)[]; week?: string }>({
    days: [],
  });
  const [pending, startTransition] = useTransition();
  const firstName = person.name.split(" ")[0] ?? person.name;

  const openingLabel = opening
    ? `${describeOpenDays(opening)}, ${sharedHours(opening, { padded: true }) ?? "hours vary by day"}`
    : null;
  const warnings = context.openingHours ? hoursOutsideOpening(days, context.openingHours) : [];
  const weekMinutes = days.reduce((sum, day) => sum + dayMinutes(day), 0);

  function save() {
    const parsed = weekSchemaFor({
      intervalMin: context.slotIntervalMin,
      requireOpenDay: false,
    }).safeParse(days);
    if (!parsed.success) {
      const perDay: (string | undefined)[] = [];
      let week: string | undefined;
      for (const issue of parsed.error.issues) {
        const index = issue.path[0];
        if (typeof index === "number") perDay[index] ??= issue.message;
        else week ??= issue.message;
      }
      setErrors({ days: perDay, week });
      return;
    }
    setErrors({ days: [] });
    startTransition(async () => {
      const result = await saveStaffHoursAction(person.id, { days });
      if (!result.ok) {
        setErrors({ days: [], week: result.error.message });
        return;
      }
      toast.success(`Saved ${firstName}'s hours`, {
        description: result.data.warnings.length
          ? "Some hours are outside opening hours. That's allowed; customers only see times the business is open."
          : undefined,
      });
    });
  }

  const businessClosed = (weekday: number) =>
    opening && !opening.find((d) => d.weekday === weekday)?.open ? (
      <span className="rounded-full border px-2 py-0.5 text-caption text-muted-foreground">
        Business closed
      </span>
    ) : null;

  if (!canEdit) {
    return (
      <section aria-labelledby="hours-title" className="flex flex-col gap-4">
        <HoursHeading id="hours-title" name={firstName} openingLabel={openingLabel} />
        <ul className="divide-y border-y">
          {WEEK_ORDER.map((weekday) => {
            const day = days.find((d) => d.weekday === weekday)!;
            return (
              <li key={weekday} className="flex min-h-11 items-center justify-between gap-4 py-2">
                <span className="text-label">{WEEKDAY_NAMES[weekday]}</span>
                <span className="font-mono text-mono text-muted-foreground tabular-nums">
                  {day.open && day.ranges.length
                    ? day.ranges.map((r) => `${r.start} – ${r.end}`).join(", ")
                    : "Off"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <section aria-labelledby="hours-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <HoursHeading id="hours-title" name={firstName} openingLabel={openingLabel} />
        <Button onClick={save} disabled={pending} className="h-11 px-5 text-label">
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Save hours
        </Button>
      </div>

      <WeekEditor
        stacked
        showTotals
        days={days}
        onChange={setDays}
        intervalMin={context.slotIntervalMin}
        errors={errors.days}
        switchLabel={(day) => `${firstName} works ${day}`}
        closedLabel="Off"
        verbs={{ start: "starts", end: "ends" }}
        dayNote={businessClosed}
        disabled={pending}
      />

      {warnings.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg bg-warning-soft px-4 py-3 text-body-sm text-warning-text">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Outside opening hours (allowed)</p>
            <ul className="mt-1 list-disc pl-4">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {errors.week && (
        <p role="alert" className="text-body-sm text-danger-text">
          {errors.week}
        </p>
      )}
      <p className="text-body-sm text-muted-foreground">
        {weekMinutes
          ? `${formatDuration(weekMinutes)} a week. Customers can book ${firstName} ${gridWords(context.slotIntervalMin)} inside these times.`
          : `${firstName} isn't working any days, so customers can't book them.`}
      </p>
    </section>
  );
}

function HoursHeading({
  id,
  name,
  openingLabel,
}: {
  id: string;
  name: string;
  openingLabel: string | null;
}) {
  return (
    <div>
      <h3 id={id} className="text-title">
        {name}&rsquo;s weekly hours
      </h3>
      <p className="text-body-sm text-muted-foreground">
        {openingLabel ? `Opening hours: ${openingLabel}` : "Opening hours aren't set yet."}
      </p>
    </div>
  );
}

// ── Time off ────────────────────────────────────────────────────────────

type Entry = DashboardStaff["timeOff"][number];

export function TimeOffPanel({
  person,
  canEdit,
  context,
}: {
  person: DashboardStaff;
  canEdit: boolean;
  context: ScheduleContext;
}) {
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [showPast, setShowPast] = useState(false);
  const upcoming = person.timeOff.filter((t) => t.endsAt > context.now);
  const past = person.timeOff.filter((t) => t.endsAt <= context.now).reverse();
  const firstName = person.name.split(" ")[0] ?? person.name;

  return (
    <section aria-labelledby="time-off-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="time-off-title" className="text-title">
          Time off
        </h3>
        {canEdit && !editing && (
          <Button
            variant="secondary"
            className="h-11 px-4 text-label"
            onClick={() => setEditing({ id: null })}
          >
            <Plus aria-hidden />
            Add time off
          </Button>
        )}
      </div>

      {editing && editing.id === null && (
        <TimeOffForm staffId={person.id} context={context} onDone={() => setEditing(null)} />
      )}

      {upcoming.length === 0 && !editing ? (
        <p className="rounded-lg border bg-background px-4 py-6 text-center text-body-sm text-muted-foreground">
          No time off planned for {firstName}.
        </p>
      ) : (
        <TimeOffList
          entries={upcoming}
          canEdit={canEdit}
          context={context}
          editingId={editing?.id ?? null}
          onEdit={(id) => setEditing({ id })}
          onDone={() => setEditing(null)}
        />
      )}

      {past.length > 0 && (
        <div className="flex flex-col gap-3">
          <Button
            variant="ghost"
            className="h-11 self-start px-3 text-label"
            aria-expanded={showPast}
            onClick={() => setShowPast((v) => !v)}
          >
            {showPast ? "Hide past time off" : `Show past time off (${past.length})`}
          </Button>
          {showPast && (
            <TimeOffList
              entries={past}
              canEdit={canEdit}
              context={context}
              editingId={editing?.id ?? null}
              onEdit={(id) => setEditing({ id })}
              onDone={() => setEditing(null)}
              muted
            />
          )}
        </div>
      )}

      <p className="text-body-sm text-muted-foreground">
        Customers can&rsquo;t book {firstName} during time off. Bookings already made stay as they
        are.
      </p>
    </section>
  );
}

function TimeOffList({
  entries,
  canEdit,
  context,
  editingId,
  onEdit,
  onDone,
  muted = false,
}: {
  entries: Entry[];
  canEdit: boolean;
  context: ScheduleContext;
  editingId: string | null;
  onEdit: (id: string) => void;
  onDone: () => void;
  muted?: boolean;
}) {
  return (
    <ul className="divide-y border-y">
      {entries.map((entry) =>
        editingId === entry.id ? (
          <li key={entry.id} className="py-4">
            <TimeOffForm entry={entry} context={context} onDone={onDone} />
          </li>
        ) : (
          <TimeOffRow
            key={entry.id}
            entry={entry}
            canEdit={canEdit}
            context={context}
            onEdit={onEdit}
            muted={muted}
          />
        ),
      )}
    </ul>
  );
}

function TimeOffRow({
  entry,
  canEdit,
  context,
  onEdit,
  muted,
}: {
  entry: Entry;
  canEdit: boolean;
  context: ScheduleContext;
  onEdit: (id: string) => void;
  muted: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const label = timeOffLabel(entry, context.timezone);

  function remove() {
    startTransition(async () => {
      const result = await removeTimeOffAction(entry.id);
      if (result.ok) toast.success("Time off removed");
      else toast.error(result.error.message);
    });
  }

  return (
    <li className={cn("flex flex-wrap items-center gap-3 py-3", pending && "opacity-60")}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
        <CalendarDays aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-label", muted && "text-muted-foreground")}>{label}</p>
        {entry.reason && <p className="text-body-sm text-muted-foreground">{entry.reason}</p>}
      </div>
      {canEdit &&
        (confirming ? (
          <div className="flex gap-2" role="group" aria-label={`Delete ${label}?`}>
            <Button
              variant="secondary"
              className="h-11 px-3 text-label"
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
            <Button
              disabled={pending}
              className="h-11 bg-destructive px-3 text-label text-destructive-foreground hover:bg-destructive-hover"
              onClick={remove}
            >
              Delete
            </Button>
          </div>
        ) : (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              className="h-11 px-3 text-label"
              onClick={() => onEdit(entry.id)}
            >
              Edit<span className="sr-only"> time off {label}</span>
            </Button>
            <Button
              variant="ghost"
              className="h-11 px-3 text-label text-danger-text hover:bg-danger-soft hover:text-danger-text"
              onClick={() => setConfirming(true)}
            >
              Delete<span className="sr-only"> time off {label}</span>
            </Button>
          </div>
        ))}
    </li>
  );
}

function TimeOffForm({
  staffId,
  entry,
  context,
  onDone,
}: {
  staffId?: string;
  entry?: Entry;
  context: ScheduleContext;
  onDone: () => void;
}) {
  const today = todayIn(context.timezone, context.now);
  const [values, setValues] = useState<TimeOffInput>(() =>
    entry
      ? toTimeOffInput(entry, context.timezone)
      : {
          allDay: true,
          startDate: today,
          endDate: today,
          startTime: "09:00",
          endTime: "17:00",
          reason: "",
        },
  );
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const times = useMemo(() => timeOptions(context.slotIntervalMin), [context.slotIntervalMin]);
  const id = useId();
  const ids = {
    allDay: `${id}-all-day`,
    start: `${id}-start`,
    end: `${id}-end`,
    from: `${id}-from`,
    to: `${id}-to`,
    reason: `${id}-reason`,
  };

  const set = <K extends keyof TimeOffInput>(key: K, value: TimeOffInput[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = timeOffSchemaFor(context.timezone, context.slotIntervalMin).safeParse(values);
    if (!parsed.success) {
      const { fieldErrors } = z.flattenError(parsed.error);
      setErrors(Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0]])));
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = entry
        ? await editTimeOffAction(entry.id, values)
        : await addTimeOffAction(staffId!, values);
      if (!result.ok) {
        const fields = result.error.fieldErrors ?? {};
        setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v?.[0]])));
        if (Object.keys(fields).length === 0) setFormError(result.error.message);
        return;
      }
      toast.success(entry ? "Time off updated" : "Time off added");
      onDone();
    });
  }

  const describedBy = (key: string) => (errors[key] ? `${id}-${key}-error` : undefined);

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label={entry ? "Edit time off" : "Add time off"}
      className="flex flex-col gap-4 rounded-xl border bg-background p-4"
    >
      {formError && (
        <p role="alert" className="text-body-sm text-danger-text">
          {formError}
        </p>
      )}
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={ids.allDay} className="text-label">
          All day
        </Label>
        <Switch
          id={ids.allDay}
          size="lg"
          checked={values.allDay}
          onCheckedChange={(on) => set("allDay", on)}
        />
      </div>

      {values.allDay ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField
            id={ids.start}
            label="First day"
            value={values.startDate}
            onChange={(v) => set("startDate", v)}
            error={errors.startDate}
            describedBy={describedBy("startDate")}
            errorId={`${id}-startDate-error`}
          />
          <DateField
            id={ids.end}
            label="Last day"
            value={values.endDate}
            onChange={(v) => set("endDate", v)}
            error={errors.endDate}
            describedBy={describedBy("endDate")}
            errorId={`${id}-endDate-error`}
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[minmax(10rem,1.4fr)_1fr_1fr]">
          <DateField
            id={ids.start}
            label="Date"
            value={values.startDate}
            onChange={(v) => set("startDate", v)}
            error={errors.startDate}
            describedBy={describedBy("startDate")}
            errorId={`${id}-startDate-error`}
          />
          {(
            [
              ["startTime", "From", ids.from],
              ["endTime", "To", ids.to],
            ] as const
          ).map(([key, label, fieldId]) => (
            <div key={key} className="flex flex-col gap-2">
              <Label htmlFor={fieldId} className="text-label">
                {label}
              </Label>
              <NativeSelect
                id={fieldId}
                value={values[key]}
                onChange={(event) => set(key, event.target.value)}
                aria-invalid={!!errors[key] || undefined}
                aria-describedby={describedBy(key)}
                className="[&_select]:font-mono [&_select]:tabular-nums"
              >
                {(times.includes(values[key]) ? times : [values[key], ...times]).map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </NativeSelect>
              <FieldError id={`${id}-${key}-error`} message={errors[key]} />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={ids.reason} className="text-label">
            Reason
          </Label>
          <span className="text-body-sm text-muted-foreground">
            Optional · only your team sees it
          </span>
        </div>
        <Input
          id={ids.reason}
          value={values.reason}
          placeholder="Holiday, training…"
          onChange={(event) => set("reason", event.target.value)}
          aria-invalid={!!errors.reason || undefined}
          aria-describedby={describedBy("reason")}
          className="h-11 px-3 text-body md:text-body"
        />
        <FieldError id={`${id}-reason-error`} message={errors.reason} />
      </div>

      <p className="text-body-sm text-muted-foreground">
        Times are in the business&rsquo;s timezone ({context.timezone.replaceAll("_", " ")}).
      </p>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" className="h-11 px-4 text-label" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="h-11 px-4 text-label">
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          {entry ? "Save time off" : "Add time off"}
        </Button>
      </div>
    </form>
  );
}

function DateField({
  id,
  label,
  value,
  onChange,
  error,
  describedBy,
  errorId,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  describedBy?: string;
  errorId: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-label">
        {label}
      </Label>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy}
        className="h-11 px-3 font-mono text-body tabular-nums md:text-body"
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

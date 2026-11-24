"use client";

import { CalendarX2, ChevronLeft, ChevronRight, CircleAlert, Clock } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useCustomerTimeZone } from "@/hooks/use-customer-time-zone";
import { useStepNavigation } from "@/hooks/use-step-navigation";
import {
  type BookingState,
  bookingHref,
  cancellationPolicy,
  chipLabel,
  lastBookableDate,
  nearestOpenings,
  PERIODS,
  periodOf,
  type PublicBusinessProfile,
  type PublicService,
  relativeDay,
  type SlotChip,
  type SlotsResponse,
} from "@/lib/booking-page";
import { formatInZone } from "@/lib/dates";
import { formatPrice } from "@/lib/money";
import { nextDate } from "@/lib/time-off";
import { gmtOffset, timeZoneLabel } from "@/lib/timezones";
import { cn } from "@/lib/utils";
import { zoneClock } from "@/lib/zone-clock";

import {
  BottomBar,
  type StepAction,
  StepLayout,
  StepProgress,
  SummaryCard,
} from "./booking-layout";
import { FOCUS_RING } from "./choice-card";

type Props = {
  slug: string;
  business: PublicBusinessProfile;
  service: PublicService;
  withWhom: string;
  /** Whether there's anyone else to choose ("Choose someone else"). */
  canChooseStaff: boolean;
  state: BookingState;
  /** The request time, from the server. */
  now: string;
  /**
   * Where each state lives. Default: the booking page (/b/[slug]). The
   * manage page maps "details" to its confirm step.
   */
  hrefFor?: (state: Partial<BookingState>) => Route;
  /** Rescheduling: the manage token, so the booking's own time shows as free. */
  manageToken?: string;
  /** The four-step progress bar (off when rescheduling). */
  showProgress?: boolean;
  /**
   * Rescheduling: the booking's current start (ISO). With no day chosen, the
   * picker opens on its day if that day still has times, else on the first
   * day of that week that has some.
   */
  openAt?: string;
};

/**
 * Step 3: a week strip, the day's times by morning, afternoon and evening on
 * the customer's own clock (docs/design/booking-flow/3-*). Times load after
 * hydration, once the browser has told us its timezone.
 */
export function TimeStep(props: Props) {
  const zone = useCustomerTimeZone();
  return zone ? <TimeStepIn zone={zone} {...props} /> : <TimeStepFrame {...props} loading />;
}

const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** A failed load: offline or a server error, or too many lookups (with the server's message). */
type Failed = { failed: "error" } | { failed: "rate_limited"; message: string };
type Loaded = SlotsResponse | Failed;
const isLoaded = (week: Loaded | undefined): week is SlotsResponse => !!week && "days" in week;

async function readSlots(response: Response): Promise<Loaded> {
  if (response.ok) return (await response.json()) as SlotsResponse;
  if (response.status === 429) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    return {
      failed: "rate_limited",
      message: body.message ?? "You're checking times very quickly. Wait a moment, then try again.",
    };
  }
  return { failed: "error" };
}

function TimeStepIn({
  zone,
  slug,
  business,
  service,
  withWhom,
  canChooseStaff,
  state,
  now,
  hrefFor = (next) => bookingHref(slug, next),
  manageToken,
  showProgress,
  openAt,
}: Props & { zone: string }) {
  const router = useRouter();
  const navigation = useStepNavigation();
  const clock = zoneClock(zone);
  const nowMs = Date.parse(now);
  const today = clock.parts(nowMs).date;
  // On the business's clock, like the slot engine (L4).
  const lastDate = lastBookableDate(new Date(nowMs), business, zone);
  const inRange = (date: string | null) =>
    date && date >= today && date <= lastDate ? date : null;
  const requested = inRange(state.date);
  const preferred = requested
    ? null
    : inRange(openAt ? clock.parts(Date.parse(openAt)).date : null);
  const weekStart = nextDate(
    today,
    7 * Math.floor(daysBetween(today, requested ?? preferred ?? today) / 7),
  );
  const weekDates = Array.from({ length: 7 }, (_, i) => nextDate(weekStart, i));

  // Weeks already loaded, so flicking back and forth doesn't refetch.
  const key = `${service.id}|${state.staffId}|${weekStart}`;
  const [weeks, setWeeks] = useState<Record<string, Loaded>>({});
  const week = weeks[key];
  // No day chosen yet: start on the first day with times this week.
  const selectedDate =
    requested ??
    (isLoaded(week) && preferred && week.days[preferred]?.available.length
      ? preferred
      : undefined) ??
    (isLoaded(week) ? weekDates.find((date) => week.days[date]?.available.length) : undefined) ??
    preferred ??
    today;
  useEffect(() => {
    if (week) return;
    const controller = new AbortController();
    const search = new URLSearchParams({
      service: service.id,
      staff: state.staffId,
      from: new Date(clock.instant(weekStart, "00:00")).toISOString(),
      to: new Date(clock.instant(nextDate(weekStart, 7), "00:00")).toISOString(),
      tz: zone,
      ...(manageToken ? { manage: manageToken } : {}),
    });
    fetch(`/api/slots/${slug}?${search}`, { signal: controller.signal })
      .then(readSlots)
      .catch((error: unknown): Loaded | null =>
        error instanceof DOMException && error.name === "AbortError" ? null : { failed: "error" },
      )
      .then((loaded) => {
        if (loaded) setWeeks((all) => ({ ...all, [key]: loaded }));
      });
    return () => controller.abort();
  }, [week, key, slug, service.id, state.staffId, weekStart, zone, clock, manageToken]);

  const day = isLoaded(week) ? week.days[selectedDate] : undefined;
  const available = day?.available ?? [];
  const [picked, setPicked] = useState<string | null>(state.start);
  const chosen = available.find((slot) => slot.start === picked) ?? null;

  const go = (date: string, start: string | null = null) => {
    setPicked(start);
    router.replace(hrefFor({ ...state, date, start: null, taken: null }), {
      scroll: false,
    });
  };

  const dateLabel = (date: string, pattern: string) =>
    formatInZone(new Date(clock.instant(date, "12:00")), zone, pattern);

  const action = {
    label: "Continue",
    disabled: !chosen,
    pending: navigation.pending,
    onClick: () =>
      chosen &&
      navigation.push(
        hrefFor({
          ...state,
          step: "details",
          date: selectedDate,
          start: chosen.start,
          taken: null,
        }),
      ),
  };

  return (
    <TimeStepFrame
      slug={slug}
      business={business}
      service={service}
      withWhom={withWhom}
      canChooseStaff={canChooseStaff}
      state={state}
      now={now}
      showProgress={showProgress}
      chosen={chosen}
      zone={zone}
      action={action}
      prompt={state.taken ? "Choose another time" : "Choose a time"}
      header={
        <WeekHeader
          title={dateLabel(selectedDate, "MMMM yyyy")}
          range={rangeLabel(weekDates, dateLabel)}
          canGoBack={weekStart > today}
          canGoForward={nextDate(weekStart, 7) <= lastDate}
          onBack={() => go(nextDate(weekStart, -7) < today ? today : nextDate(weekStart, -7))}
          onForward={() => go(nextDate(weekStart, 7))}
        />
      }
      strip={
        <DayStrip
          dates={weekDates}
          today={today}
          lastDate={lastDate}
          selected={selectedDate}
          week={isLoaded(week) ? week : null}
          label={dateLabel}
          onSelect={(date) => go(date)}
        />
      }
      timezoneNote={<TimezoneNote zone={zone} business={business} now={nowMs} />}
    >
      {!week ? (
        <TimesSkeleton label={`Checking times for ${dateLabel(selectedDate, "EEE d MMM")}…`} />
      ) : !isLoaded(week) ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border p-6">
          {week.failed === "rate_limited" ? (
            <>
              <p className="text-title">Slow down a little</p>
              <p className="text-body text-muted-foreground">{week.message}</p>
            </>
          ) : (
            <>
              <p className="text-title">We couldn&rsquo;t load the times</p>
              <p className="text-body text-muted-foreground">
                Check your connection and try again.
              </p>
            </>
          )}
          <Button
            variant="secondary"
            className="h-11 px-4"
            onClick={() =>
              setWeeks((all) => {
                const { [key]: _failed, ...rest } = all;
                return rest;
              })
            }
          >
            Try again
          </Button>
        </div>
      ) : (
        <>
          {state.taken && state.date === selectedDate && (
            <JustTaken
              taken={state.taken}
              zone={zone}
              openings={nearestOpenings(available, state.taken)}
              onPick={setPicked}
            />
          )}
          {available.length === 0 ? (
            <NoTimes
              dateLabel={dateLabel(selectedDate, "EEE d MMM")}
              full={(day?.taken.length ?? 0) > 0}
              isToday={selectedDate === today}
              next={
                weekDates
                  .filter((date) => date > selectedDate)
                  .map((date) => week.days[date]?.available[0])
                  .find(Boolean) ??
                week.next ??
                null
              }
              zone={zone}
              now={new Date(nowMs)}
              onNext={(slot) => go(slot.date, slot.start)}
              staffHref={
                canChooseStaff
                  ? hrefFor({ ...state, step: "staff", start: null, taken: null })
                  : null
              }
            />
          ) : (
            <TimeGrid
              available={available}
              taken={day?.taken ?? []}
              justTaken={state.date === selectedDate ? state.taken : null}
              picked={chosen?.start ?? null}
              onPick={setPicked}
            />
          )}
        </>
      )}
    </TimeStepFrame>
  );
}

function rangeLabel(dates: string[], label: (date: string, pattern: string) => string) {
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return `${label(first, sameMonth ? "d" : "d MMM")} – ${label(last, "d MMMM yyyy")}`;
}

/** The frame around the step, shared by the loading (pre-hydration) and live states. */
function TimeStepFrame({
  business,
  service,
  withWhom,
  chosen = null,
  zone,
  action = { label: "Continue", disabled: true },
  prompt = "Choose a time",
  header,
  strip,
  timezoneNote,
  loading,
  children,
  showProgress = true,
}: Props & {
  chosen?: SlotChip | null;
  zone?: string;
  action?: StepAction;
  prompt?: string;
  header?: React.ReactNode;
  strip?: React.ReactNode;
  timezoneNote?: React.ReactNode;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  const price = formatPrice(service.priceCents, business.currency);
  const when =
    chosen && zone ? (
      <>
        {formatInZone(new Date(chosen.start), zone, "EEE d MMM")} ·{" "}
        <span className="font-mono tabular-nums">
          {chipLabel(chosen)} – {formatInZone(new Date(chosen.end), zone, "HH:mm")}
        </span>
      </>
    ) : null;

  return (
    <StepLayout
      aside={
        <SummaryCard
          rows={[
            { label: "Service", value: service.name },
            { label: "With", value: withWhom },
            {
              label: "Date",
              value: chosen && zone ? formatInZone(new Date(chosen.start), zone, "EEE d MMM") : "–",
            },
            {
              label: "Time",
              value:
                chosen && zone ? (
                  <span className="font-mono tabular-nums">
                    {chipLabel(chosen)} – {formatInZone(new Date(chosen.end), zone, "HH:mm")}
                  </span>
                ) : (
                  "–"
                ),
            },
          ]}
          total={price}
          action={action}
          policy={cancellationPolicy(business.cancellationWindowHours)}
        />
      }
      bar={
        <BottomBar
          title={`${service.name} · ${withWhom}`}
          detail={when ?? <span className="font-mono">{prompt}</span>}
          action={action}
        />
      }
    >
      {showProgress && <StepProgress step="time" />}
      <h2 className="hidden text-display lg:block">Pick a date and time</h2>
      {header}
      {strip}
      {timezoneNote}
      {loading ? <TimesSkeleton label="Checking times…" /> : children}
    </StepLayout>
  );
}

function WeekHeader({
  title,
  range,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: {
  title: string;
  range: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  const nav = "size-11 rounded-xl";
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-heading lg:hidden">{title}</p>
      <p className="hidden text-title lg:block">{range}</p>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          className={cn(nav, "lg:border lg:bg-card")}
          disabled={!canGoBack}
          onClick={onBack}
          aria-label="Previous week"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Button>
        <Button
          variant="ghost"
          className={cn(nav, "lg:border lg:bg-card")}
          disabled={!canGoForward}
          onClick={onForward}
          aria-label="Next week"
        >
          <ChevronRight aria-hidden className="size-5" />
        </Button>
      </div>
    </div>
  );
}

function DayStrip({
  dates,
  today,
  lastDate,
  selected,
  week,
  label,
  onSelect,
}: {
  dates: string[];
  today: string;
  lastDate: string;
  selected: string;
  week: SlotsResponse | null;
  label: (date: string, pattern: string) => string;
  onSelect: (date: string) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">Day</legend>
      {/* Below 360 px seven columns get too narrow to read: scroll instead (L1). */}
      <div className="-mx-1 grid grid-cols-7 gap-1.5 px-1 max-[359px]:flex max-[359px]:snap-x max-[359px]:overflow-x-auto max-[359px]:py-1 sm:gap-3">
        {dates.map((date) => {
          const day = week?.days[date];
          const open = day?.available.length ?? 0;
          const beyond = date > lastDate;
          const closed =
            week !== null && (beyond || (!day?.available.length && !day?.taken.length));
          const full = week !== null && !closed && open === 0;
          // Today after its last time has nothing left, but it isn't closed.
          const status = !week
            ? ""
            : closed
              ? date === today && !beyond
                ? "No times"
                : "Closed"
              : full
                ? "Full"
                : `${open} open`;
          const isSelected = date === selected;
          return (
            <label
              key={date}
              className={cn(
                "flex min-h-18 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border py-2 text-center transition-colors max-[359px]:w-16 max-[359px]:shrink-0 max-[359px]:snap-start",
                FOCUS_RING,
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : closed
                    ? "border-dashed bg-background text-muted-foreground"
                    : "bg-card hover:border-input",
                beyond && "cursor-not-allowed",
              )}
            >
              <input
                type="radio"
                name="day"
                value={date}
                checked={isSelected}
                disabled={beyond}
                onChange={() => onSelect(date)}
                className="sr-only"
              />
              <span className="text-body-sm">{date === today ? "Today" : label(date, "EEE")}</span>
              <span
                className={cn(
                  "text-title",
                  closed && !isSelected && date !== today && "line-through",
                )}
              >
                {label(date, "d")}
              </span>
              <span className="sr-only">{label(date, "MMMM")}</span>
              {status && <span className="sr-only">, {status}</span>}
              {/* Phones: a dot for open days. Desktop: the count. */}
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full sm:hidden",
                  open > 0
                    ? isSelected
                      ? "bg-primary-foreground"
                      : "bg-primary"
                    : "bg-transparent",
                )}
              />
              <span
                aria-hidden
                className={cn(
                  "hidden text-body-sm sm:block",
                  !isSelected && (open > 0 ? "text-success-text" : "text-muted-foreground"),
                )}
              >
                {status || " "}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function TimezoneNote({
  zone,
  business,
  now,
}: {
  zone: string;
  business: PublicBusinessProfile;
  now: number;
}) {
  const at = new Date(now);
  const mine = gmtOffset(zone, at);
  const theirs = gmtOffset(business.timezone, at);
  return (
    <p className="flex items-start gap-2 text-body-sm text-muted-foreground">
      <Clock aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        Times shown in your timezone ({mine})
        {mine !== theirs && (
          <>
            . {business.name} is in {timeZoneLabel(business.timezone, at)}.
          </>
        )}
      </span>
    </p>
  );
}

function TimesSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <p role="status" className="text-body text-muted-foreground">
        {label}
      </p>
      {[0, 1].map((group) => (
        <div key={group} aria-hidden className="flex flex-col gap-3">
          <div className="h-5 w-24 animate-pulse rounded-full bg-muted" />
          <div className="grid grid-cols-4 gap-3 lg:grid-cols-6">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimeGrid({
  available,
  taken,
  justTaken,
  picked,
  onPick,
}: {
  available: SlotChip[];
  taken: SlotChip[];
  justTaken: string | null;
  picked: string | null;
  onPick: (start: string) => void;
}) {
  const all = [
    ...available.map((slot) => ({ slot, open: true })),
    ...taken.map((slot) => ({ slot, open: false })),
  ].sort((a, b) => Date.parse(a.slot.start) - Date.parse(b.slot.start));

  return (
    <fieldset className="flex flex-col gap-6 lg:rounded-2xl lg:border lg:bg-card lg:p-8">
      <legend className="sr-only">Time</legend>
      {PERIODS.map(({ id, label }) => {
        const chips = all.filter(({ slot }) => periodOf(slot.time) === id);
        if (chips.length === 0) return null;
        const open = chips.filter((c) => c.open).length;
        return (
          <section key={id} aria-labelledby={`period-${id}`} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h3 id={`period-${id}`} className="text-title">
                {label}
              </h3>
              <p className="text-body-sm text-muted-foreground">{open} open</p>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:gap-3 lg:grid-cols-6">
              {chips.map(({ slot, open }) =>
                open ? (
                  <label
                    key={slot.start}
                    className={cn(
                      "flex h-12 cursor-pointer items-center justify-center rounded-xl border font-mono text-label tabular-nums transition-colors",
                      FOCUS_RING,
                      picked === slot.start
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-card hover:bg-muted",
                    )}
                  >
                    <input
                      type="radio"
                      name="time"
                      value={slot.start}
                      checked={picked === slot.start}
                      onChange={() => onPick(slot.start)}
                      className="sr-only"
                    />
                    {chipLabel(slot)}
                  </label>
                ) : (
                  <span
                    key={slot.start}
                    className={cn(
                      "flex h-12 items-center justify-center rounded-xl font-mono text-label tabular-nums line-through",
                      slot.start === justTaken
                        ? "border border-danger bg-danger-soft text-danger-text"
                        : "border border-dashed bg-background text-muted-foreground",
                    )}
                  >
                    {chipLabel(slot)}
                    <span className="sr-only"> (taken)</span>
                  </span>
                ),
              )}
            </div>
          </section>
        );
      })}
    </fieldset>
  );
}

function JustTaken({
  taken,
  zone,
  openings,
  onPick,
}: {
  taken: string;
  zone: string;
  openings: SlotChip[];
  onPick: (start: string) => void;
}) {
  return (
    <div role="alert" className="flex gap-3 rounded-2xl bg-danger-soft p-5 text-danger-text">
      <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="flex flex-col gap-3">
        <p className="text-title">That time was just taken</p>
        <p className="text-body">
          Someone booked{" "}
          <span className="font-mono tabular-nums">
            {formatInZone(new Date(taken), zone, "HH:mm")}
          </span>{" "}
          a moment ago.{" "}
          {openings.length > 0
            ? "These are the nearest openings:"
            : "There's nothing else left this day."}
        </p>
        {openings.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {openings.map((slot) => (
              <Button
                key={slot.start}
                variant="outline"
                className="h-11 rounded-full bg-card px-5 font-mono text-foreground tabular-nums"
                onClick={() => onPick(slot.start)}
              >
                {chipLabel(slot)}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NoTimes({
  dateLabel,
  full,
  isToday,
  next,
  zone,
  now,
  onNext,
  staffHref,
}: {
  dateLabel: string;
  full: boolean;
  isToday: boolean;
  next: SlotChip | null;
  zone: string;
  now: Date;
  onNext: (slot: SlotChip) => void;
  staffHref: Route | null;
}) {
  const why = full
    ? `${dateLabel} is fully booked.`
    : isToday
      ? "There are no more times today."
      : `There are no times on ${dateLabel}.`;
  const nextDay = next ? relativeDay(next.start, zone, now) : null;
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-primary-tint text-primary-tint-foreground">
        <CalendarX2 aria-hidden className="size-6" />
      </span>
      <h3 className="text-title">No times this day</h3>
      <p className="max-w-sm text-body text-muted-foreground">
        {why}{" "}
        {next
          ? `The next opening is ${nextDay === "Today" || nextDay === "Tomorrow" ? nextDay!.toLowerCase() : nextDay}.`
          : "There are no openings in the booking window."}
      </p>
      {next && (
        <Button className="h-12 w-full max-w-sm px-6 text-label" onClick={() => onNext(next)}>
          Next available: {nextDay}{" "}
          <span className="font-mono tabular-nums">{chipLabel(next)}</span>
        </Button>
      )}
      {staffHref && (
        <Button asChild variant="ghost" className="h-11 px-4 text-label">
          <Link href={staffHref}>Choose someone else</Link>
        </Button>
      )}
    </div>
  );
}

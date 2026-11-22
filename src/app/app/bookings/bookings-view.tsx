"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  type BookingFilters,
  bookingFiltersQuery,
  PAGE_SIZE,
  RANGE_LABELS,
  RANGES,
  retainSelection,
  type SortKey,
} from "@/lib/bookings-filter";
import { formatInZone } from "@/lib/dates";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { BookingRow } from "@/server/db/queries/bookings-list";
import type { BookingOptions } from "@/server/db/queries/calendar";

import { BookingDrawer } from "../_booking/booking-drawer";
import { BookingSheet } from "../_booking/booking-sheet";
import { SourceBadge, StaffName, STATUS_LABEL, StatusBadge } from "../_booking/booking-ui";
import { CopyLinkButton } from "../_today/header-actions";
import { bulkCancelAction, bulkOutcomeAction } from "../booking-actions";

const focusRing = "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";
const SOURCE_LABEL = { page: "Page", widget: "Widget", ai: "AI", manual: "Manual" } as const;

export function BookingsView({
  filters,
  rows,
  total,
  empty,
  today,
  zone,
  currency,
  businessName,
  bookingUrl,
  role,
  options,
  openBookingId,
}: {
  filters: BookingFilters;
  rows: BookingRow[];
  total: number;
  /** The business has no bookings at all. */
  empty: boolean;
  today: string;
  zone: string;
  currency: string;
  businessName: string;
  bookingUrl: string;
  role: "owner" | "staff";
  options: BookingOptions;
  openBookingId: string | null;
}) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<string | null>(openBookingId);
  // ⌘K opens a booking by linking here with ?booking=: follow it on every new link.
  const [lastOpen, setLastOpen] = useState(openBookingId);
  if (openBookingId !== lastOpen) {
    setLastOpen(openBookingId);
    setDrawer(openBookingId);
  }
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [bulkPending, startBulk] = useTransition();

  // Staff may change only their own bookings (RLS): only those get a checkbox.
  const myStaff = new Set(options.staff.filter((s) => s.isMe).map((s) => s.id));
  const canSelect = (row: BookingRow) => role === "owner" || myStaff.has(row.staffId);
  const selectable = rows.filter(canSelect);

  // New filters or another page clear the selection. A refresh of the same
  // view (a live booking, a colleague's change) keeps whatever is still shown.
  const view = bookingFiltersQuery(filters);
  const shownIds = selectable.map((r) => r.id).join();
  const [lastView, setLastView] = useState(view);
  const [lastShown, setLastShown] = useState(shownIds);
  if (view !== lastView) {
    setLastView(view);
    setLastShown(shownIds);
    setSelected(new Set());
  } else if (shownIds !== lastShown) {
    setLastShown(shownIds);
    setSelected((current) =>
      retainSelection(
        current,
        selectable.map((r) => r.id),
      ),
    );
  }

  function go(next: Partial<BookingFilters>) {
    const query = bookingFiltersQuery({ ...filters, page: 1, ...next });
    startNavigation(() => router.replace(`/app/bookings${query}` as Route, { scroll: false }));
  }

  const href = (next: Partial<BookingFilters>) =>
    `/app/bookings${bookingFiltersQuery({ ...filters, ...next })}` as Route;
  const exportHref = `/app/bookings/export${bookingFiltersQuery({ ...filters, page: 1 })}`;

  const ids = [...selected];
  function bulkOutcome(outcome: "completed" | "no_show") {
    startBulk(async () => {
      const result = await bulkOutcomeAction(ids, outcome);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      const { marked, skipped } = result.data;
      const what = outcome === "completed" ? "complete" : "no-show";
      toast.success(`Marked ${marked} ${marked === 1 ? "booking" : "bookings"} ${what}`, {
        description:
          skipped > 0
            ? `${skipped} couldn't be: not started yet, cancelled, already marked, or not yours.`
            : undefined,
      });
      setSelected(new Set());
    });
  }

  function bulkCancel() {
    startBulk(async () => {
      const result = await bulkCancelAction(ids);
      setConfirmCancel(false);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      const { cancelled, notCancelled, notified } = result.data;
      toast.success(`Cancelled ${cancelled} ${cancelled === 1 ? "booking" : "bookings"}`, {
        description: [
          notified > 0
            ? "The customers are being emailed."
            : "Email isn't set up yet, so let the customers know yourself.",
          notCancelled > 0
            ? `${notCancelled} couldn't be cancelled (already cancelled or not yours).`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
      setSelected(new Set());
    });
  }

  const allOnPage = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const someOnPage = selectable.some((r) => selected.has(r.id));
  const first = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(total, filters.page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // A refresh or bulk change can leave the page number beyond the last page.
  const pastEnd = rows.length === 0 && total > 0;
  const upcomingOnly = ["today", "next7", "next30", "upcoming"].includes(filters.range);

  return (
    <main
      aria-label="Bookings"
      className="flex w-full max-w-7xl min-w-0 flex-col gap-6 px-4 py-8 sm:px-6 lg:px-12 lg:py-12"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-heading sm:text-display">Bookings</h1>
          <p className="mt-1 text-body text-muted-foreground">
            {empty
              ? `${businessName} · nothing booked yet`
              : upcomingOnly
                ? "Upcoming bookings across the team"
                : "Bookings across the team"}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {empty ? (
            <Button type="button" variant="secondary" disabled className="h-11 px-5 text-label">
              <Download aria-hidden />
              Export CSV
            </Button>
          ) : (
            <Button asChild variant="secondary" className="h-11 px-5 text-label">
              <a href={exportHref} download>
                <Download aria-hidden />
                Export CSV
              </a>
            </Button>
          )}
          <Button type="button" className="h-11 px-5 text-label" onClick={() => setSheetOpen(true)}>
            <Plus aria-hidden />
            New booking
          </Button>
        </div>
      </div>

      <Toolbar filters={filters} options={options} disabled={empty} onChange={go} />

      {selected.size > 0 && (
        <div
          role="region"
          aria-label="Selected bookings"
          className="flex flex-wrap items-center gap-3 rounded-xl bg-foreground px-4 py-3 text-background"
        >
          <span className="mr-2 text-label" aria-live="polite">
            {selected.size} selected
          </span>
          {(
            [
              ["completed", "Mark complete"],
              ["no_show", "Mark no-show"],
            ] as const
          ).map(([outcome, label]) => (
            <button
              key={outcome}
              type="button"
              disabled={bulkPending}
              onClick={() => bulkOutcome(outcome)}
              className={cn(
                "min-h-11 rounded-lg border border-background/40 px-4 text-label hover:bg-background/10 disabled:opacity-60",
                "focus-visible:ring-3 focus-visible:ring-background/60 focus-visible:outline-none",
              )}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={bulkPending}
            onClick={() => setConfirmCancel(true)}
            className="min-h-11 rounded-lg border border-background/40 px-4 text-label hover:bg-background/10 focus-visible:ring-3 focus-visible:ring-background/60 focus-visible:outline-none disabled:opacity-60"
          >
            Cancel bookings
          </button>
          {bulkPending && <Loader2 aria-label="Working" className="size-4 animate-spin" />}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto min-h-11 px-2 text-label underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-background/60 focus-visible:outline-none"
          >
            Clear selection
          </button>
        </div>
      )}

      <div
        className={cn(
          "relative overflow-x-auto rounded-xl border bg-card transition-opacity",
          navigating && "opacity-60",
        )}
        aria-busy={navigating || undefined}
      >
        <table className="w-full min-w-[60rem] border-collapse text-left text-body">
          <caption className="sr-only">
            Bookings, {RANGE_LABELS[filters.range].toLowerCase()}
            {total > 0 && !pastEnd && `, showing ${first} to ${last} of ${total}`}
          </caption>
          <thead>
            <tr className="border-b text-body-sm text-muted-foreground">
              <th scope="col" className="w-14 py-3 pl-6">
                <Checkbox
                  aria-label={
                    role === "owner"
                      ? "Select all bookings on this page"
                      : "Select all your bookings on this page"
                  }
                  disabled={selectable.length === 0}
                  checked={allOnPage ? true : someOnPage ? "indeterminate" : false}
                  onCheckedChange={(on) =>
                    setSelected(on === true ? new Set(selectable.map((r) => r.id)) : new Set())
                  }
                  className="size-5"
                />
              </th>
              <SortHeader label="Customer" sort="customer" filters={filters} href={href} />
              <th scope="col" className="px-3 py-3 font-normal">
                Service
              </th>
              <th scope="col" className="px-3 py-3 font-normal">
                Staff
              </th>
              <SortHeader label="Date and time" sort="date" filters={filters} href={href} />
              <SortHeader label="Status" sort="status" filters={filters} href={href} />
              <th scope="col" className="px-3 py-3 font-normal">
                Source
              </th>
              <th scope="col" className="px-3 py-3 font-normal">
                Code
              </th>
              <SortHeader label="Price" sort="price" filters={filters} href={href} align="right" />
              <th scope="col" className="w-14 py-3 pr-4">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isSelected = selected.has(row.id);
              return (
                <tr
                  key={row.id}
                  onClick={(event) => {
                    // Clicks on the row open the booking; controls handle their own.
                    if ((event.target as HTMLElement).closest("button, a, [role=checkbox]")) return;
                    setDrawer(row.id);
                  }}
                  className={cn(
                    "cursor-pointer border-b last:border-b-0 hover:bg-muted/50",
                    isSelected && "bg-primary-tint/30",
                  )}
                >
                  <td className="py-4 pl-6">
                    {canSelect(row) && (
                      <Checkbox
                        aria-label={`Select ${row.customerName}, ${row.code}`}
                        checked={isSelected}
                        onCheckedChange={(on) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (on === true) next.add(row.id);
                            else next.delete(row.id);
                            return next;
                          })
                        }
                        className="size-5"
                      />
                    )}
                  </td>
                  <td className="px-3 py-4">
                    <button
                      type="button"
                      onClick={() => setDrawer(row.id)}
                      className={cn("rounded text-left text-label hover:underline", focusRing)}
                    >
                      {row.customerName}
                      <span className="sr-only">, open booking {row.code}</span>
                    </button>
                  </td>
                  <td className="px-3 py-4">{row.serviceName}</td>
                  <td className="px-3 py-4 whitespace-nowrap">
                    <StaffName name={row.staffName} color={row.staffColor} />
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap">
                    {formatInZone(row.startsAt, zone, "EEE d MMM")} ·{" "}
                    <span className="font-mono tabular-nums">
                      {formatInZone(row.startsAt, zone, "HH:mm")}
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-4">
                    <SourceBadge source={row.source} />
                  </td>
                  <td className="px-3 py-4 font-mono text-body-sm whitespace-nowrap tabular-nums">
                    {row.code}
                  </td>
                  <td className="px-3 py-4 text-right font-mono whitespace-nowrap tabular-nums">
                    {formatPrice(row.priceCents, currency)}
                  </td>
                  <td className="py-4 pr-4 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`More for ${row.customerName}, ${row.code}`}
                        className={cn(
                          "inline-flex size-11 items-center justify-center rounded-lg hover:bg-muted",
                          focusRing,
                        )}
                      >
                        <MoreHorizontal aria-hidden className="size-5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="min-h-11" onSelect={() => setDrawer(row.id)}>
                          Open booking
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild className="min-h-11">
                          <Link href={`/app/customers/${row.customerId}` as Route}>
                            View customer
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 &&
          (empty ? (
            <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-xl bg-primary-tint text-primary-tint-foreground">
                <ClipboardList aria-hidden className="size-6" />
              </span>
              <h2 className="text-title">No bookings yet</h2>
              <p className="max-w-lg text-body text-muted-foreground">
                When customers book through your page, website widget or AI receptionist, every
                booking appears here with its source.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <CopyLinkButton url={bookingUrl} variant="default" />
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 px-5 text-label"
                  onClick={() => setSheetOpen(true)}
                >
                  Add a booking yourself
                </Button>
              </div>
            </div>
          ) : pastEnd ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <h2 className="text-title">That page is past the end</h2>
              <p className="text-body text-muted-foreground">
                The list has <span className="font-mono tabular-nums">{pages}</span>{" "}
                {pages === 1 ? "page" : "pages"} now.
              </p>
              <Link
                href={href({ page: pages })}
                className={cn(
                  "min-h-11 content-center text-label text-primary underline underline-offset-4",
                  focusRing,
                )}
              >
                Go to page {pages}
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <h2 className="text-title">No bookings match</h2>
              <p className="text-body text-muted-foreground">
                Try another date range, or clear the filters.
              </p>
              <Link
                href={"/app/bookings?range=all" as Route}
                className={cn(
                  "min-h-11 content-center text-label text-primary underline underline-offset-4",
                  focusRing,
                )}
              >
                Clear filters
              </Link>
            </div>
          ))}
      </div>

      {total > 0 && !pastEnd && (
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-body text-muted-foreground">
            Showing{" "}
            <span className="font-mono text-foreground tabular-nums">
              {first}–{last}
            </span>{" "}
            of <span className="font-mono text-foreground tabular-nums">{total}</span>
          </p>
          {pages > 1 && (
            <ul className="flex items-center gap-2">
              <li>
                <PageLink
                  href={href({ page: filters.page - 1 })}
                  disabled={filters.page <= 1}
                  label="Previous page"
                >
                  <ChevronLeft aria-hidden className="size-5" />
                </PageLink>
              </li>
              {pageWindow(filters.page, pages).map((p, i) =>
                p === null ? (
                  <li key={`gap-${i}`} aria-hidden className="px-1 text-muted-foreground">
                    …
                  </li>
                ) : (
                  <li key={p}>
                    <PageLink
                      href={href({ page: p })}
                      current={p === filters.page}
                      label={`Page ${p}`}
                    >
                      <span className="font-mono tabular-nums">{p}</span>
                    </PageLink>
                  </li>
                ),
              )}
              <li>
                <PageLink
                  href={href({ page: filters.page + 1 })}
                  disabled={filters.page >= pages}
                  label="Next page"
                >
                  <ChevronRight aria-hidden className="size-5" />
                </PageLink>
              </li>
            </ul>
          )}
        </nav>
      )}

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent className="gap-6 sm:max-w-md">
          <DialogHeader className="gap-2">
            <DialogTitle className="text-title">
              Cancel {selected.size} {selected.size === 1 ? "booking" : "bookings"}?
            </DialogTitle>
            <DialogDescription className="text-body text-muted-foreground">
              Each customer is emailed that their appointment is cancelled, and the times open up
              again. This can&rsquo;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3">
            <Button
              type="button"
              variant="secondary"
              className="h-11 px-5 text-label"
              onClick={() => setConfirmCancel(false)}
            >
              Keep them
            </Button>
            <Button
              type="button"
              disabled={bulkPending}
              onClick={bulkCancel}
              className="h-11 bg-destructive px-5 text-label text-destructive-foreground hover:bg-destructive-hover"
            >
              {bulkPending && <Loader2 aria-hidden className="animate-spin" />}
              Cancel bookings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BookingSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        start={{ date: today }}
        options={options}
        currency={currency}
        staffOnly={role === "staff"}
      />
      <BookingDrawer
        bookingId={drawer}
        onClose={() => {
          setDrawer(null);
          if (openBookingId) {
            router.replace(href({ page: filters.page }), { scroll: false });
          } else {
            router.refresh();
          }
        }}
        zone={zone}
        currency={currency}
        role={role}
        options={options}
      />
    </main>
  );
}

function Toolbar({
  filters,
  options,
  disabled,
  onChange,
}: {
  filters: BookingFilters;
  options: BookingOptions;
  disabled: boolean;
  onChange: (next: Partial<BookingFilters>) => void;
}) {
  const id = useId();
  const [q, setQ] = useState(filters.q);
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  // Search as you type, a moment after the last key.
  useEffect(() => {
    if (q.trim() === filters.q) return;
    const timer = setTimeout(() => latest.current({ q: q.trim() }), 300);
    return () => clearTimeout(timer);
  }, [q, filters.q]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-60 flex-1 basis-72">
          <label htmlFor={`${id}-q`} className="sr-only">
            Search customer, email or code
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={`${id}-q`}
            type="search"
            value={q}
            disabled={disabled}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search customer, email or code"
            className="h-11 pr-3 pl-9 text-body md:text-body"
          />
        </div>
        <FilterSelect
          label="Date"
          value={filters.range}
          disabled={disabled}
          onChange={(value) => onChange({ range: value as BookingFilters["range"] })}
          options={RANGES.map((r) => [r, RANGE_LABELS[r]])}
        />
        <FilterSelect
          label="Status"
          value={filters.status ?? ""}
          disabled={disabled}
          onChange={(value) => onChange({ status: (value || null) as BookingFilters["status"] })}
          options={[
            ["", "All"],
            ...(["pending", "confirmed", "completed", "no_show", "cancelled"] as const).map(
              (s) => [s, STATUS_LABEL[s]] as [string, string],
            ),
          ]}
        />
        <FilterSelect
          label="Staff"
          value={filters.staff ?? ""}
          disabled={disabled}
          onChange={(value) => onChange({ staff: value || null })}
          options={[["", "All"], ...options.staff.map((s) => [s.id, s.name] as [string, string])]}
        />
        <FilterSelect
          label="Service"
          value={filters.service ?? ""}
          disabled={disabled}
          onChange={(value) => onChange({ service: value || null })}
          options={[
            ["", "All"],
            ...options.services.map((s) => [s.id, s.name] as [string, string]),
          ]}
        />
        <FilterSelect
          label="Source"
          value={filters.source ?? ""}
          disabled={disabled}
          onChange={(value) => onChange({ source: (value || null) as BookingFilters["source"] })}
          options={[["", "All"], ...Object.entries(SOURCE_LABEL)]}
        />
      </div>
      {filters.range === "custom" && (
        <div className="flex flex-wrap items-end gap-3">
          {(["from", "to"] as const).map((key) => (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={`${id}-${key}`} className="text-body-sm text-muted-foreground">
                {key === "from" ? "From" : "To"}
              </label>
              <Input
                id={`${id}-${key}`}
                type="date"
                value={filters[key] ?? ""}
                onChange={(event) => onChange({ [key]: event.target.value || null })}
                className="h-11 px-3 font-mono text-body tabular-nums md:text-body"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A labelled native select styled as the mockup's filter chip ("Status All ⌄"). */
function FilterSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "relative flex h-11 items-center gap-1 rounded-lg border border-input bg-card pl-3 has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        disabled && "opacity-60",
      )}
    >
      <label htmlFor={id} className="text-body-sm text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-full appearance-none bg-transparent pr-8 pl-1 text-label outline-none"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-3 size-4 text-muted-foreground"
      >
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function SortHeader({
  label,
  sort,
  filters,
  href,
  align,
}: {
  label: string;
  sort: SortKey;
  filters: BookingFilters;
  href: (next: Partial<BookingFilters>) => Route;
  align?: "right";
}) {
  const active = filters.sort === sort;
  const nextDir = active && filters.dir === "asc" ? "desc" : "asc";
  return (
    <th
      scope="col"
      aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-3 font-normal", align === "right" && "text-right")}
    >
      <Link
        href={href({ sort, dir: nextDir, page: 1 })}
        scroll={false}
        className={cn(
          "inline-flex min-h-11 items-center gap-1 rounded hover:text-foreground",
          active && "text-foreground",
          focusRing,
        )}
      >
        {label}
        {active &&
          (filters.dir === "asc" ? (
            <ArrowUp aria-hidden className="size-3.5" />
          ) : (
            <ArrowDown aria-hidden className="size-3.5" />
          ))}
        <span className="sr-only">, sort {nextDir === "asc" ? "ascending" : "descending"}</span>
      </Link>
    </th>
  );
}

function PageLink({
  href,
  label,
  current,
  disabled,
  children,
}: {
  href: Route;
  label: string;
  current?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const style = cn(
    "flex size-11 items-center justify-center rounded-lg border text-label",
    current ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
    focusRing,
  );
  if (disabled) {
    return (
      <span aria-disabled="true" aria-label={label} className={cn(style, "opacity-50")}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      className={style}
    >
      {children}
    </Link>
  );
}

/** Page numbers to show: the first, the last, and two either side of the current one. */
function pageWindow(page: number, pages: number): (number | null)[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (const p of sorted) {
    const prev = out.at(-1);
    if (typeof prev === "number" && p - prev > 1) out.push(null);
    out.push(p);
  }
  return out;
}

"use client";

import { Lock, Mail, Phone, Sparkle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { initialsOf } from "@/lib/color";
import { formatInZone } from "@/lib/dates";
import { formatAmount, formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { BookingOptions } from "@/server/db/queries/calendar";
import type { CustomerBooking, CustomerProfile } from "@/server/db/queries/customers";

import { BookingDrawer } from "../../_booking/booking-drawer";
import { BookingSheet } from "../../_booking/booking-sheet";
import { SourceBadge, StaffName, StatusBadge } from "../../_booking/booking-ui";
import { saveNotesAction } from "../actions";

const focusRing = "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export function CustomerProfileView({
  profile: p,
  zone,
  currency,
  role,
  options,
  today,
}: {
  profile: CustomerProfile;
  zone: string;
  currency: string;
  role: "owner" | "staff";
  options: BookingOptions;
  today: string;
}) {
  const router = useRouter();
  const [drawer, setDrawer] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const firstName = p.name.split(" ")[0] ?? p.name;
  const time = (date: Date) => formatInZone(date, zone, "HH:mm");

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-center gap-5 rounded-xl border bg-card p-6">
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-title"
        >
          {initialsOf(p.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-heading">{p.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-1 text-body text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Mail aria-hidden className="size-4" />
              <a href={`mailto:${p.email}`} className="text-primary underline underline-offset-4">
                {p.email}
              </a>
            </span>
            <span className="inline-flex items-center gap-2">
              <Phone aria-hidden className="size-4" />
              {p.phone ? (
                <a href={`tel:${p.phone}`} className="text-primary underline underline-offset-4">
                  {p.phone}
                </a>
              ) : (
                "No phone given"
              )}
            </span>
            <span>Customer since {formatInZone(p.createdAt, zone, "MMMM yyyy")}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="secondary" className="h-11 px-5 text-label">
            <a href={`mailto:${p.email}`}>Email {firstName}</a>
          </Button>
          <Button type="button" className="h-11 px-5 text-label" onClick={() => setSheetOpen(true)}>
            New booking for {firstName}
          </Button>
        </div>
      </section>

      <ul aria-label="Totals" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Total spent" value={formatAmount(p.stats.totalSpentCents, currency)} />
        <Stat label="Visits" value={String(p.stats.visits)} />
        <Stat label="No-shows" value={String(p.stats.noShows)} />
        <Stat label="Upcoming" value={String(p.stats.upcoming)} />
      </ul>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="upcoming" className="flex flex-col gap-3">
            <h2 id="upcoming" className="text-title">
              Upcoming bookings
            </h2>
            {p.upcoming.length === 0 ? (
              <p className="rounded-xl border border-dashed bg-card p-5 text-body text-muted-foreground">
                Nothing booked ahead.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {p.upcoming.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-card p-5"
                  >
                    <div className="min-w-36">
                      <p className="font-mono text-title tabular-nums">
                        {time(b.startsAt)} – {time(b.endsAt)}
                      </p>
                      <p className="text-body-sm text-muted-foreground">
                        {formatInZone(b.startsAt, zone, "EEE d MMM")}
                      </p>
                    </div>
                    <div className="min-w-52 flex-1">
                      <p className="text-label">{b.serviceName}</p>
                      <p className="flex flex-wrap gap-x-1.5 text-body-sm text-muted-foreground">
                        <span className="whitespace-nowrap">
                          with <StaffName name={b.staffName} color={b.staffColor} />
                        </span>
                        <span aria-hidden>·</span>
                        <span className="font-mono whitespace-nowrap tabular-nums">{b.code}</span>
                      </p>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-3">
                      <StatusBadge status={b.status} />
                      <SourceBadge source={b.source} />
                      <button
                        type="button"
                        onClick={() => setDrawer(b.id)}
                        className={cn(
                          "min-h-11 rounded text-label text-primary underline underline-offset-4",
                          focusRing,
                        )}
                      >
                        Open<span className="sr-only"> booking {b.code}</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <History bookings={p.history} zone={zone} currency={currency} onOpen={setDrawer} />
        </div>

        <div className="flex flex-col gap-6">
          <Notes profile={p} zone={zone} canEdit={role === "owner"} firstName={firstName} />
          {p.openQuestion && (
            <section
              aria-labelledby="question"
              className="flex flex-col gap-3 rounded-xl border bg-card p-6"
            >
              <h2 id="question" className="flex items-center gap-2 text-title">
                <span aria-hidden className="size-2 rounded-full bg-warning" />
                Question for the team
              </h2>
              <p className="text-body">&ldquo;{p.openQuestion.message}&rdquo;</p>
              <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
                <Sparkle aria-hidden className="size-4" />
                Passed on by the AI receptionist ·{" "}
                {formatInZone(p.openQuestion.createdAt, zone, "d MMM")},{" "}
                <span className="font-mono tabular-nums">{time(p.openQuestion.createdAt)}</span>
              </p>
              <Button asChild className="h-11 w-fit px-5 text-label">
                <a href={`mailto:${p.email}`}>Reply by email</a>
              </Button>
            </section>
          )}
        </div>
      </div>

      <BookingSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        start={{
          date: today,
          customer: { id: p.id, name: p.name, email: p.email, phone: p.phone },
        }}
        options={options}
        currency={currency}
        staffOnly={role === "staff"}
      />
      <BookingDrawer
        bookingId={drawer}
        onClose={() => {
          setDrawer(null);
          router.refresh();
        }}
        zone={zone}
        currency={currency}
        role={role}
        options={options}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border bg-card p-4 sm:p-6">
      <p className="text-body-sm text-muted-foreground">{label}</p>
      <p className="font-mono text-heading tabular-nums">{value}</p>
    </li>
  );
}

function History({
  bookings,
  zone,
  currency,
  onOpen,
}: {
  bookings: CustomerBooking[];
  zone: string;
  currency: string;
  onOpen: (id: string) => void;
}) {
  const paid = bookings
    .filter((b) => b.status === "completed")
    .reduce((sum, b) => sum + b.priceCents, 0);
  return (
    <section aria-labelledby="history" className="flex flex-col gap-3">
      <h2 id="history" className="text-title">
        Visit history
      </h2>
      {bookings.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-5 text-body text-muted-foreground">
          No past visits yet.
        </p>
      ) : (
        <div className="relative overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[36rem] border-collapse text-left text-body">
            <thead>
              <tr className="border-b text-body-sm text-muted-foreground">
                <th scope="col" className="py-3 pl-6 font-normal">
                  Date
                </th>
                <th scope="col" className="px-3 py-3 font-normal">
                  Service
                </th>
                <th scope="col" className="px-3 py-3 font-normal">
                  Staff
                </th>
                <th scope="col" className="px-3 py-3 font-normal">
                  Status
                </th>
                <th scope="col" className="py-3 pr-6 text-right font-normal">
                  Paid
                </th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-b">
                  <td className="py-4 pl-6 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onOpen(b.id)}
                      className={cn("rounded text-left hover:underline", focusRing)}
                    >
                      {formatInZone(b.startsAt, zone, "EEE d MMM yyyy")} ·{" "}
                      <span className="font-mono tabular-nums">
                        {formatInZone(b.startsAt, zone, "HH:mm")}
                      </span>
                      <span className="sr-only">, open booking {b.code}</span>
                    </button>
                  </td>
                  <td className="px-3 py-4">{b.serviceName}</td>
                  <td className="px-3 py-4">{b.staffName}</td>
                  <td className="px-3 py-4">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="py-4 pr-6 text-right font-mono tabular-nums">
                    {b.status === "completed" ? (
                      formatPrice(b.priceCents, currency)
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4} className="py-4 pl-6 text-left text-label">
                  Total
                </th>
                <td className="py-4 pr-6 text-right font-mono text-label tabular-nums">
                  {formatAmount(paid, currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function Notes({
  profile: p,
  zone,
  canEdit,
  firstName,
}: {
  profile: CustomerProfile;
  zone: string;
  canEdit: boolean;
  firstName: string;
}) {
  const id = useId();
  const [notes, setNotes] = useState(p.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = notes.trim() !== (p.notes ?? "");

  function save() {
    startTransition(async () => {
      const result = await saveNotesAction(p.id, { notes });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setError(null);
      toast.success("Notes saved");
    });
  }

  const edited =
    p.notesUpdatedAt &&
    `Edited by ${p.notesUpdatedBy ?? "a team member"} · ${formatInZone(p.notesUpdatedAt, zone, "d MMM")}, ${formatInZone(p.notesUpdatedAt, zone, "HH:mm")}`;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-xl border bg-card p-6"
    >
      <h2 id={`${id}-title`} className="flex items-center gap-2 text-title">
        <Lock aria-hidden className="size-5" />
        Private notes
      </h2>
      <p id={`${id}-hint`} className="text-body-sm text-muted-foreground">
        Only your team sees these. Never shown to {firstName} or the AI receptionist.
      </p>
      {canEdit ? (
        <>
          <label htmlFor={`${id}-notes`} className="sr-only">
            Private notes about {p.name}
          </label>
          <Textarea
            id={`${id}-notes`}
            rows={5}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            aria-describedby={error ? `${id}-error ${id}-hint` : `${id}-hint`}
            aria-invalid={!!error || undefined}
            className="px-3 text-body md:text-body"
          />
          {error && (
            <p id={`${id}-error`} role="alert" className="text-body-sm text-danger-text">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body-sm text-muted-foreground">
              {edited || (p.notes ? "" : "No notes yet.")}
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={pending || !dirty}
              onClick={save}
              className="h-11 px-5 text-label"
            >
              Save notes
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={cn("text-body whitespace-pre-line", !p.notes && "text-muted-foreground")}>
            {p.notes ?? "No notes yet."}
          </p>
          <p className="text-body-sm text-muted-foreground">
            {edited ? `${edited}. ` : ""}Only owners can edit them.
          </p>
        </>
      )}
    </section>
  );
}

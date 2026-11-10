"use client";

import { Plus, UserPlus, Users } from "lucide-react";
import { useId, useMemo, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { fromAvailabilityRows, type OpeningRange, weeklyHoursLabel } from "@/lib/hours";
import { timeOffLabel } from "@/lib/time-off";
import { cn } from "@/lib/utils";
import type { StaffFormInput, StaffFormValues } from "@/lib/validation/staff";
import type { DashboardStaff } from "@/server/db/queries/staff";

import { saveStaffAction } from "./actions";
import { InviteDialog } from "./invite-dialog";
import type { ScheduleContext } from "./schedule";
import { StaffSheet } from "./staff-sheet";

export type ServiceOption = { id: string; name: string };

type Props = {
  staff: DashboardStaff[];
  services: ServiceOption[];
  canEdit: boolean;
  timezone: string;
  slotIntervalMin: number;
  openingHours: OpeningRange[] | null;
  /** Request time from the server (ISO), so "upcoming" is stable across renders. */
  now: string;
};
type Row = DashboardStaff & { pending?: boolean };

const EDGE = {
  teal: "border-l-staff-teal",
  violet: "border-l-staff-violet",
  pink: "border-l-staff-pink",
} as const;
const AVATAR = {
  teal: "bg-staff-teal-soft text-staff-teal-text",
  violet: "bg-staff-violet-soft text-staff-violet-text",
  pink: "bg-staff-pink-soft text-staff-pink-text",
} as const;

type SheetState =
  { open: false } | { open: true; staffId: string | null; draft?: StaffFormInput; error?: string };

export function StaffView({ staff, services, canEdit, ...schedule }: Props) {
  const context: ScheduleContext = useMemo(
    () => ({
      timezone: schedule.timezone,
      slotIntervalMin: schedule.slotIntervalMin,
      openingHours: schedule.openingHours,
      now: new Date(schedule.now),
    }),
    [schedule.timezone, schedule.slotIntervalMin, schedule.openingHours, schedule.now],
  );
  const [people, upsert] = useOptimistic<Row[], Row>(staff, (list, row) =>
    list.some((p) => p.id === row.id)
      ? list.map((p) => (p.id === row.id ? row : p))
      : [...list, row],
  );
  const [, startTransition] = useTransition();
  const [sheet, setSheet] = useState<SheetState>({ open: false });
  const [inviting, setInviting] = useState(false);
  const selected = sheet.open && sheet.staffId ? people.find((p) => p.id === sheet.staffId) : null;
  // Revoking an invite can remove the person it created: close their sheet.
  const sheetOpen = sheet.open && (sheet.staffId === null || !!selected);

  function save(raw: StaffFormInput, values: StaffFormValues) {
    const staffId = sheet.open ? sheet.staffId : null;
    const previous = staffId ? people.find((p) => p.id === staffId) : undefined;
    setSheet({ open: false });
    startTransition(async () => {
      upsert({
        id: staffId ?? `new-${Date.now()}`,
        email: previous?.email ?? null,
        color: previous?.color ?? "teal",
        linked: previous?.linked ?? false,
        isOwner: previous?.isOwner ?? false,
        hours: previous?.hours ?? [],
        upcomingTimeOff: previous?.upcomingTimeOff ?? 0,
        timeOff: previous?.timeOff ?? [],
        isMe: previous?.isMe ?? false,
        invite: previous?.invite ?? null,
        ...values,
        pending: true,
      });
      const result = await saveStaffAction(raw, staffId ?? undefined);
      if (result.ok) toast.success(staffId ? `Saved ${values.name}` : `Added ${values.name}`);
      else setSheet({ open: true, staffId, draft: raw, error: result.error.message });
    });
  }

  const count = people.length;
  return (
    <PageBody>
      <PageHeader
        title="Staff"
        description={`${count} ${count === 1 ? "person" : "people"} · each gets their own colour on the calendar.`}
        actions={
          canEdit ? (
            <>
              <Button
                variant="secondary"
                className="h-11 px-4 text-label"
                onClick={() => setSheet({ open: true, staffId: null })}
              >
                <Plus aria-hidden />
                Add staff
              </Button>
              <Button className="h-11 px-4 text-label" onClick={() => setInviting(true)}>
                <UserPlus aria-hidden />
                Invite staff
              </Button>
            </>
          ) : null
        }
      />

      {!canEdit && (
        <p className="rounded-lg bg-info-soft px-4 py-3 text-body-sm text-info-text">
          You can see your team. Only owners can add people or change their details.
        </p>
      )}

      {people.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary-tint text-primary-tint-foreground">
            <Users aria-hidden className="size-6" />
          </span>
          <h2 className="text-title">No one on the team yet</h2>
          <p className="max-w-md text-body text-muted-foreground">
            Add the people customers can book. Invite them to sign in so they can see the calendar
            and manage their own bookings.
          </p>
          {canEdit && (
            <Button className="mt-2 h-11 px-5 text-label" onClick={() => setInviting(true)}>
              <UserPlus aria-hidden />
              Invite staff
            </Button>
          )}
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {people.map((person) => (
            <li key={person.id}>
              <StaffCard
                person={person}
                canEdit={canEdit}
                context={context}
                onOpen={() => setSheet({ open: true, staffId: person.id })}
              />
            </li>
          ))}
        </ul>
      )}

      <StaffSheet
        open={sheetOpen}
        onOpenChange={(open) => !open && setSheet({ open: false })}
        person={selected ?? null}
        draft={sheet.open ? sheet.draft : undefined}
        serverError={sheet.open ? sheet.error : undefined}
        services={services}
        canEdit={canEdit}
        context={context}
        onSave={save}
      />
      {canEdit && <InviteDialog open={inviting} onOpenChange={setInviting} services={services} />}
    </PageBody>
  );
}

export function statusOf(person: DashboardStaff): "active" | "invited" | "inactive" {
  if (person.invite) return "invited";
  return person.active ? "active" : "inactive";
}

export function StatusBadge({ person, id }: { person: DashboardStaff; id?: string }) {
  const status = statusOf(person);
  const styles = {
    active: "bg-success-soft text-success-text",
    invited: "bg-info-soft text-info-text",
    inactive: "border text-muted-foreground",
  } as const;
  const labels = { active: "Active", invited: "Invited", inactive: "Not bookable" } as const;
  return (
    <span
      id={id}
      className={cn("rounded-full px-2.5 py-0.5 text-caption whitespace-nowrap", styles[status])}
    >
      {labels[status]}
    </span>
  );
}

export function StaffAvatar({
  person,
  size = "md",
}: {
  person: DashboardStaff;
  size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-title",
        size === "lg" ? "size-14" : "size-12",
        AVATAR[person.color],
      )}
    >
      {person.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export const hoursLabel = (person: DashboardStaff) =>
  person.hours.length ? weeklyHoursLabel(fromAvailabilityRows(person.hours)) : "No hours set";

function StaffCard({
  person,
  canEdit,
  context,
  onOpen,
}: {
  person: Row;
  canEdit: boolean;
  context: ScheduleContext;
  onOpen: () => void;
}) {
  const nextOff = person.timeOff.find((t) => t.endsAt > context.now);
  // Named "Edit Aiko" from a hidden verb and the visible name; described by
  // the rest of the card, so screen readers hear what sighted users see.
  const ids = { verb: useId(), name: useId(), title: useId(), status: useId(), details: useId() };
  const verb = canEdit ? "Edit" : person.isMe ? "Open your schedule," : "View";
  const services = person.serviceIds.length;
  // Someone who could take bookings but offers nothing can't be booked.
  const unbookable = services === 0 && (person.active || person.invite !== null);
  const extras = [
    unbookable ? null : `${services} ${services === 1 ? "service" : "services"}`,
    person.upcomingTimeOff ? `${person.upcomingTimeOff} time off planned` : null,
  ].filter(Boolean);
  const subtitle = [person.title, person.isOwner ? "Owner" : null].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={person.pending}
      aria-haspopup="dialog"
      aria-labelledby={`${ids.verb} ${ids.name}`}
      aria-describedby={[subtitle || canEdit ? ids.title : null, ids.status, ids.details]
        .filter(Boolean)
        .join(" ")}
      className={cn(
        "flex h-full w-full flex-col gap-4 rounded-xl border border-l-4 bg-card p-5 text-left hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        EDGE[person.color],
        person.pending && "opacity-60",
        !person.active && !person.invite && "bg-background",
      )}
    >
      <span id={ids.verb} className="sr-only">
        {verb}
      </span>
      <span className="flex w-full items-start gap-4">
        <StaffAvatar person={person} />
        <span className="min-w-0 flex-1">
          <span id={ids.name} className="block truncate text-title">
            {person.name}
          </span>
          {subtitle ? (
            <span id={ids.title} className="block truncate text-body-sm text-muted-foreground">
              {subtitle}
            </span>
          ) : (
            // Owners are nudged to fill it in (the card opens the editor); staff see nothing.
            canEdit && (
              <span id={ids.title} className="block truncate text-body-sm text-muted-foreground">
                Add a title
              </span>
            )
          )}
        </span>
        <StatusBadge person={person} id={ids.status} />
      </span>
      <span id={ids.details} className="flex flex-col gap-1">
        <span className="font-mono text-mono-sm text-muted-foreground tabular-nums">
          {hoursLabel(person)}
        </span>
        {unbookable && (
          <span className="text-body-sm font-medium text-warning-text">
            {canEdit ? "Not bookable yet — assign a service" : "Not bookable yet"}
          </span>
        )}
        {extras.length > 0 && (
          <span className="text-body-sm text-muted-foreground">{extras.join(" · ")}</span>
        )}
        {nextOff && (
          <span className="text-body-sm">
            Next time off:{" "}
            <span className="font-medium">{timeOffLabel(nextOff, context.timezone)}</span>
          </span>
        )}
        {person.invite && (
          <span className="truncate text-body-sm text-info-text">
            Invite sent to {person.invite.email}
          </span>
        )}
      </span>
    </button>
  );
}

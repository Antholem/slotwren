"use client";

import { Archive, ChevronRight, Plus, Scissors } from "lucide-react";
import { useId, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { formatMinutes } from "@/lib/durations";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ServiceFormInput, ServiceFormValues } from "@/lib/validation/services";
import type { DashboardService, StaffOption } from "@/server/db/queries/services";

import { removeServiceAction, restoreServiceAction, saveServiceAction } from "./actions";
import { ServiceSheet } from "./service-sheet";
import { StaffNames } from "./staff-chip";

type Props = {
  services: DashboardService[];
  staff: StaffOption[];
  canEdit: boolean;
  currency: string;
  currencySymbol: string;
  slotIntervalMin: number;
};

type Row = DashboardService & { pending?: boolean };

type Change =
  | { type: "upsert"; service: Row }
  | { type: "delete"; id: string }
  | { type: "archive"; id: string }
  | { type: "restore"; id: string };

function applyChange(list: Row[], change: Change): Row[] {
  switch (change.type) {
    case "upsert": {
      const exists = list.some((s) => s.id === change.service.id);
      return exists
        ? list.map((s) => (s.id === change.service.id ? change.service : s))
        : [...list, change.service];
    }
    case "delete":
      return list.filter((s) => s.id !== change.id);
    case "archive":
      return list.map((s) =>
        s.id === change.id ? { ...s, archivedAt: new Date(), active: false, pending: true } : s,
      );
    case "restore":
      return list.map((s) => (s.id === change.id ? { ...s, archivedAt: null, pending: true } : s));
  }
}

/** What the sheet shows: a service by id, a new one, or nothing. */
type SheetState =
  | { open: false }
  | { open: true; serviceId: string | null; draft?: ServiceFormInput; error?: string };

export function ServicesView(props: Props) {
  const { staff, canEdit, currency, slotIntervalMin } = props;
  const [services, change] = useOptimistic<Row[], Change>(props.services, applyChange);
  const [, startTransition] = useTransition();
  const [sheet, setSheet] = useState<SheetState>({ open: false });

  const live = services.filter((s) => !s.archivedAt);
  const archived = services.filter((s) => s.archivedAt);
  const editing =
    sheet.open && sheet.serviceId ? services.find((s) => s.id === sheet.serviceId) : null;

  function save(raw: ServiceFormInput, values: ServiceFormValues) {
    const serviceId = sheet.open ? sheet.serviceId : null;
    const previous = serviceId ? services.find((s) => s.id === serviceId) : undefined;
    setSheet({ open: false });
    startTransition(async () => {
      change({
        type: "upsert",
        service: {
          id: serviceId ?? `new-${Date.now()}`,
          archivedAt: previous?.archivedAt ?? null,
          bookingCount: previous?.bookingCount ?? 0,
          name: values.name,
          description: values.description,
          durationMin: values.durationMin,
          priceCents: values.price,
          bufferBeforeMin: values.bufferBeforeMin,
          bufferAfterMin: values.bufferAfterMin,
          active: values.active,
          staffIds: values.staffIds,
          pending: true,
        },
      });
      const result = await saveServiceAction(raw, serviceId ?? undefined);
      if (result.ok) {
        toast.success(serviceId ? `Saved ${values.name}` : `Added ${values.name}`);
      } else {
        // Reopen with what they typed so nothing is lost.
        setSheet({ open: true, serviceId, draft: raw, error: result.error.message });
      }
    });
  }

  function remove(service: Row) {
    const archiving = service.bookingCount > 0;
    setSheet({ open: false });
    startTransition(async () => {
      change({ type: archiving ? "archive" : "delete", id: service.id });
      const result = await removeServiceAction(service.id);
      if (!result.ok) toast.error(result.error.message);
      else if (result.data.outcome === "archived") {
        toast.success(`Archived ${service.name}`, {
          description: "It's off your booking page and kept for booking history.",
        });
      } else toast.success(`Deleted ${service.name}`);
    });
  }

  function restore(service: Row) {
    startTransition(async () => {
      change({ type: "restore", id: service.id });
      const result = await restoreServiceAction(service.id);
      if (!result.ok) toast.error(result.error.message);
      else {
        toast.success(`Restored ${service.name}`, {
          description: "Turn on Bookable online to show it on your booking page again.",
        });
      }
    });
  }

  const online = live.filter((s) => s.active).length;
  const interval = slotIntervalMin === 30 ? "half hour" : "quarter hour";
  const summary =
    live.length === 0
      ? "Nothing to book yet."
      : `${live.length} ${live.length === 1 ? "service" : "services"}, ${
          online === live.length ? "all" : online
        } bookable online. Times start on the ${interval}.`;

  return (
    <PageBody>
      <PageHeader
        title="Services"
        description={summary}
        actions={
          canEdit && live.length > 0 ? (
            <Button
              className="h-11 px-4 text-label"
              onClick={() => setSheet({ open: true, serviceId: null })}
            >
              <Plus aria-hidden />
              New service
            </Button>
          ) : null
        }
      />

      {!canEdit && (
        <p className="rounded-lg bg-info-soft px-4 py-3 text-body-sm text-info-text">
          You can see your team&rsquo;s services. Only owners can change them.
        </p>
      )}

      {live.length === 0 ? (
        <EmptyState canEdit={canEdit} onAdd={() => setSheet({ open: true, serviceId: null })} />
      ) : (
        <ServiceList
          services={live}
          staff={staff}
          currency={currency}
          canEdit={canEdit}
          onOpen={(id) => setSheet({ open: true, serviceId: id })}
        />
      )}

      {archived.length > 0 && (
        <details className="group rounded-xl border bg-card">
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-6 text-label">
            <ChevronRight
              aria-hidden
              className="size-4 transition-transform group-open:rotate-90"
            />
            Archived ({archived.length})
            <span className="text-body-sm font-normal text-muted-foreground">
              · kept for booking history, not bookable
            </span>
          </summary>
          <ul className="divide-y border-t">
            {archived.map((service) => (
              <li key={service.id} className="flex items-center gap-4 px-6 py-4">
                <Archive aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label">{service.name}</p>
                  <p className="text-body-sm text-muted-foreground">
                    {service.bookingCount} {service.bookingCount === 1 ? "booking" : "bookings"}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    variant="secondary"
                    className="h-11 px-4 text-label"
                    disabled={service.pending}
                    onClick={() => restore(service)}
                  >
                    Restore<span className="sr-only"> {service.name}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ServiceSheet
        open={sheet.open}
        onOpenChange={(open) => !open && setSheet({ open: false })}
        service={editing ?? null}
        draft={sheet.open ? sheet.draft : undefined}
        serverError={sheet.open ? sheet.error : undefined}
        staff={staff}
        canEdit={canEdit}
        currency={currency}
        currencySymbol={props.currencySymbol}
        slotIntervalMin={slotIntervalMin}
        onSave={save}
        onRemove={remove}
      />
    </PageBody>
  );
}

function EmptyState({ canEdit, onAdd }: { canEdit: boolean; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-primary-tint text-primary-tint-foreground">
        <Scissors aria-hidden className="size-6" />
      </span>
      <h2 className="text-title">No services yet</h2>
      <p className="max-w-md text-body text-muted-foreground">
        Services are what customers book: a haircut, a consultation, a lesson. Each has a length, a
        price and the people who offer it.
      </p>
      {canEdit && (
        <Button className="mt-2 h-11 px-5 text-label" onClick={onAdd}>
          <Plus aria-hidden />
          Add a service
        </Button>
      )}
    </div>
  );
}

function buffersLabel(service: Row) {
  const parts = [
    service.bufferBeforeMin ? `${service.bufferBeforeMin} min before` : null,
    service.bufferAfterMin ? `${service.bufferAfterMin} min after` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "–";
}

function ServiceList({
  services,
  staff,
  currency,
  canEdit,
  onOpen,
}: {
  services: Row[];
  staff: StaffOption[];
  currency: string;
  canEdit: boolean;
  onOpen: (id: string) => void;
}) {
  const staffFor = (service: Row) => staff.filter((m) => service.staffIds.includes(m.id));
  const verb = canEdit ? "Edit" : "View";

  return (
    <>
      {/* Desktop and tablet: table */}
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <table className="w-full text-left">
          <thead className="border-b bg-muted/50 text-body-sm text-muted-foreground">
            <tr>
              <th scope="col" className="px-6 py-3 font-normal">
                Service
              </th>
              <th scope="col" className="px-4 py-3 font-normal">
                Duration
              </th>
              <th scope="col" className="px-4 py-3 text-right font-normal">
                Price
              </th>
              <th scope="col" className="px-4 py-3 font-normal">
                Buffers
              </th>
              <th scope="col" className="hidden px-4 py-3 font-normal xl:table-cell">
                Staff
              </th>
              <th scope="col" className="px-6 py-3 font-normal">
                Online
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {services.map((service) => (
              <tr
                key={service.id}
                onClick={() => !service.pending && onOpen(service.id)}
                className={cn(
                  "cursor-pointer hover:bg-muted/60",
                  service.pending && "cursor-progress opacity-60",
                )}
              >
                <td className="px-6 py-4">
                  <ServiceNameButton
                    service={service}
                    verb={verb}
                    onOpen={() => onOpen(service.id)}
                  />
                  {service.pending && <span className="sr-only">Saving</span>}
                </td>
                <td className="px-4 py-4 font-mono text-mono whitespace-nowrap tabular-nums">
                  {formatMinutes(service.durationMin)}
                </td>
                <td className="px-4 py-4 text-right font-mono text-mono whitespace-nowrap tabular-nums">
                  {formatPrice(service.priceCents, currency)}
                </td>
                <td className="px-4 py-4 text-body-sm whitespace-nowrap text-muted-foreground">
                  {buffersLabel(service)}
                </td>
                <td className="hidden px-4 py-4 text-body-sm xl:table-cell">
                  <StaffNames staff={staffFor(service)} />
                </td>
                <td className="px-6 py-4">
                  <OnlineBadge active={service.active} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className="flex flex-col gap-3 md:hidden">
        {services.map((service) => (
          <li key={service.id}>
            <ServiceCard
              service={service}
              verb={verb}
              currency={currency}
              staff={staffFor(service)}
              onOpen={() => onOpen(service.id)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

/*
 * Named "Edit Haircut" from a hidden verb and the visible name, and described
 * by the rest of what it shows, so screen readers hear what sighted users see.
 */

/** The table's first cell: the other cells are read as the row. */
function ServiceNameButton({
  service,
  verb,
  onOpen,
}: {
  service: Row;
  verb: string;
  onOpen: () => void;
}) {
  const ids = { verb: useId(), name: useId(), description: useId() };
  return (
    <button
      type="button"
      disabled={service.pending}
      aria-haspopup="dialog"
      aria-labelledby={`${ids.verb} ${ids.name}`}
      aria-describedby={service.description ? ids.description : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span id={ids.verb} className="sr-only">
        {verb}
      </span>
      <span id={ids.name} className="block text-label">
        {service.name}
      </span>
      {service.description && (
        <span id={ids.description} className="block text-body-sm text-muted-foreground">
          {service.description}
        </span>
      )}
    </button>
  );
}

function ServiceCard({
  service,
  verb,
  currency,
  staff,
  onOpen,
}: {
  service: Row;
  verb: string;
  currency: string;
  staff: StaffOption[];
  onOpen: () => void;
}) {
  const ids = {
    verb: useId(),
    name: useId(),
    description: useId(),
    status: useId(),
    details: useId(),
  };
  return (
    <button
      type="button"
      disabled={service.pending}
      aria-haspopup="dialog"
      aria-labelledby={`${ids.verb} ${ids.name}`}
      aria-describedby={[service.description && ids.description, ids.status, ids.details]
        .filter(Boolean)
        .join(" ")}
      onClick={onOpen}
      className={cn(
        "flex w-full flex-col gap-2 rounded-xl border bg-card p-4 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        service.pending && "opacity-60",
      )}
    >
      <span id={ids.verb} className="sr-only">
        {verb}
      </span>
      <span className="flex w-full items-start justify-between gap-3">
        <span className="min-w-0">
          <span id={ids.name} className="block text-label">
            {service.name}
          </span>
          {service.description && (
            <span id={ids.description} className="block text-body-sm text-muted-foreground">
              {service.description}
            </span>
          )}
        </span>
        <OnlineBadge active={service.active} id={ids.status} />
      </span>
      <span id={ids.details} className="flex flex-col gap-2">
        <span className="font-mono text-mono tabular-nums">
          {formatMinutes(service.durationMin)} · {formatPrice(service.priceCents, currency)}
        </span>
        <StaffNames staff={staff} className="text-body-sm" />
      </span>
    </button>
  );
}

function OnlineBadge({ active, id }: { active: boolean; id?: string }) {
  return active ? (
    <span
      id={id}
      className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-caption whitespace-nowrap text-success-text"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      Bookable
    </span>
  ) : (
    <span
      id={id}
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-caption whitespace-nowrap text-muted-foreground"
    >
      Hidden
    </span>
  );
}

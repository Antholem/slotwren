"use client";

import { Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCustomerTimeZone } from "@/hooks/use-customer-time-zone";
import { formatInZone } from "@/lib/dates";
import {
  type BookingState,
  bookingHref,
  type PublicService,
  type PublicStaff,
  relativeDay,
} from "@/lib/booking-page";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";

import { BottomBar, StepLayout, StepProgress, SummaryCard } from "./booking-layout";
import { ChoiceCard } from "./choice-card";

const AVATAR = {
  teal: "bg-staff-teal-soft text-staff-teal-text",
  violet: "bg-staff-violet-soft text-staff-violet-text",
  pink: "bg-staff-pink-soft text-staff-pink-text",
} as const;

/** Step 2: Anyone available (default) or a person (docs/design/booking-flow/2-choose-staff). */
export function StaffStep({
  slug,
  service,
  staff,
  currency,
  nextOpenings,
  now,
  state,
}: {
  slug: string;
  service: PublicService;
  staff: PublicStaff[];
  currency: string;
  /** Earliest opening per staff ID and for "any" (instants). */
  nextOpenings: Record<string, string | null>;
  now: string;
  state: BookingState;
}) {
  const router = useRouter();
  const zone = useCustomerTimeZone();
  const [selectedId, setSelectedId] = useState(state.staffId);
  const chosen = staff.find((p) => p.id === selectedId);
  const withWhom = chosen?.name ?? "Anyone available";
  const price = formatPrice(service.priceCents, currency);

  /** "Today 16:00" on the customer's clock. */
  const opening = (id: string) => {
    const at = nextOpenings[id];
    if (!at) return null;
    if (!zone) return "…";
    return (
      <>
        {relativeDay(at, zone, new Date(now))}{" "}
        <span className="font-mono tabular-nums">{formatInZone(new Date(at), zone, "HH:mm")}</span>
      </>
    );
  };

  const action = {
    label: "Continue",
    onClick: () =>
      router.push(
        bookingHref(slug, {
          step: "time",
          serviceId: service.id,
          staffId: selectedId,
          date: state.date,
        }),
      ),
  };

  const nextLine = (id: string, lead: string) => {
    const when = opening(id);
    // Brand-tinted text only on the tinted (selected) card it's checked against.
    const tinted = selectedId === id;
    return (
      <span className={cn("text-body", tinted && "text-primary-tint-foreground")}>
        {when ? (
          <>
            <span className={tinted ? undefined : "text-muted-foreground"}>{lead}</span> {when}
          </>
        ) : (
          <span className={tinted ? undefined : "text-muted-foreground"}>No free times soon</span>
        )}
      </span>
    );
  };

  return (
    <StepLayout
      aside={
        <SummaryCard
          rows={[
            { label: "Service", value: service.name },
            { label: "With", value: withWhom },
          ]}
          total={price}
          action={action}
        />
      }
      bar={
        <BottomBar
          title={service.name}
          detail={
            <>
              {withWhom} · <span className="font-mono tabular-nums">{service.durationMin} min</span>{" "}
              · <span className="font-mono tabular-nums">{price}</span>
            </>
          }
          action={action}
        />
      }
    >
      <StepProgress step="staff" />
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-4 flex flex-col gap-1">
          <span className="text-heading">Who would you like?</span>
          <span className="text-body text-muted-foreground">
            {service.name} ·{" "}
            <span className="font-mono tabular-nums">{service.durationMin} min</span>
          </span>
        </legend>
        <ChoiceCard
          name="staff"
          value="any"
          checked={selectedId === "any"}
          onChange={setSelectedId}
          leading={
            <span aria-hidden className="flex size-12 shrink-0 items-center justify-center">
              <Users className="size-6 text-muted-foreground" />
            </span>
          }
        >
          <span className="text-title">Anyone available</span>
          {nextLine("any", "Earliest")}
        </ChoiceCard>
        {staff.map((person) => (
          <ChoiceCard
            key={person.id}
            name="staff"
            value={person.id}
            checked={selectedId === person.id}
            onChange={setSelectedId}
            leading={
              <span
                aria-hidden
                className={cn(
                  "flex size-12 shrink-0 items-center justify-center rounded-full text-label",
                  AVATAR[person.color],
                )}
              >
                {person.name.slice(0, 2).toUpperCase()}
              </span>
            }
          >
            <span className="text-title">
              {person.name}
              {person.title && (
                <span className="text-body text-muted-foreground"> · {person.title}</span>
              )}
            </span>
            {nextLine(person.id, "Next free")}
          </ChoiceCard>
        ))}
      </fieldset>
    </StepLayout>
  );
}

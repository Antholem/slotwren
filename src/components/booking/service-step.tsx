"use client";

import { Clock } from "lucide-react";
import { useState } from "react";

import { useStepNavigation } from "@/hooks/use-step-navigation";
import { type BookingState, bookingHref, type PublicService } from "@/lib/booking-page";
import { formatPrice } from "@/lib/money";

import { BottomBar, StepLayout, StepProgress, SummaryCard } from "./booking-layout";
import { ChoiceCard } from "./choice-card";

/** Step 1: choose a service (docs/design/booking-flow/1-choose-a-service). */
export function ServiceStep({
  slug,
  services,
  currency,
  state,
}: {
  slug: string;
  services: PublicService[];
  currency: string;
  state: BookingState;
}) {
  const navigation = useStepNavigation();
  const [selectedId, setSelectedId] = useState(state.serviceId);
  const selected = services.find((s) => s.id === selectedId) ?? null;
  const price = (s: PublicService) => formatPrice(s.priceCents, currency);

  const action = {
    label: "Continue",
    disabled: !selected,
    pending: navigation.pending,
    onClick: () => {
      if (!selected) return;
      // A different service may have different people and times: start those over.
      const same = selected.id === state.serviceId;
      navigation.push(
        bookingHref(slug, {
          step: "staff",
          serviceId: selected.id,
          staffId: same ? state.staffId : "any",
          date: same ? state.date : null,
        }),
      );
    },
  };

  return (
    <StepLayout
      aside={
        <SummaryCard
          rows={[{ label: "Service", value: selected?.name ?? "Not chosen yet" }]}
          total={selected ? price(selected) : null}
          action={action}
        />
      }
      bar={
        <BottomBar
          title={selected?.name ?? "Choose a service"}
          detail={
            selected ? (
              <span className="font-mono tabular-nums">
                {selected.durationMin} min · {price(selected)}
              </span>
            ) : (
              `${services.length} to choose from`
            )
          }
          action={action}
        />
      }
    >
      <StepProgress step="service" />
      {services.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-dashed p-8 text-center">
          <h2 className="text-title">Nothing to book online yet</h2>
          <p className="text-body text-muted-foreground">
            This business hasn&rsquo;t opened any services for online booking. Get in touch with
            them directly to book.
          </p>
        </div>
      ) : (
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-4 text-heading">Choose a service</legend>
          {services.map((service) => (
            <ChoiceCard
              key={service.id}
              name="service"
              value={service.id}
              checked={service.id === selectedId}
              onChange={setSelectedId}
              trailing={<span className="font-mono text-title tabular-nums">{price(service)}</span>}
            >
              <span className="text-title">{service.name}</span>
              <span className="flex items-center gap-2 font-mono text-body text-muted-foreground tabular-nums">
                <Clock aria-hidden className="size-4" />
                {service.durationMin} min
              </span>
            </ChoiceCard>
          ))}
        </fieldset>
      )}
    </StepLayout>
  );
}

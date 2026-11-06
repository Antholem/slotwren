import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { initialsOf } from "@/lib/color";
import { openingWeek, WEEKDAY_NAMES } from "@/lib/hours";
import { currencyLabel } from "@/lib/money";
import { formatCancellation, formatNotice } from "@/lib/validation/settings";
import type { BusinessSettingsRow } from "@/server/db/queries/settings";

/** Settings → Business for staff: the same information, read-only. */
export function BusinessSummary({
  settings,
  host,
}: {
  settings: BusinessSettingsRow;
  host: string;
}) {
  const week = openingWeek(settings.openingHours);

  return (
    <div className="flex flex-col gap-6">
      <p className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3 text-body-sm text-muted-foreground">
        <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
        Only owners can change these settings. Ask an owner if something needs updating.
      </p>

      <Section title="Business">
        <Row label="Business name">{settings.name}</Row>
        <Row label="Booking link">
          <span className="font-mono text-mono break-all">
            {host}/b/{settings.slug}
          </span>
        </Row>
        <Row label="Timezone">{settings.timezone.replaceAll("_", " ")}</Row>
        <Row label="Currency">{currencyLabel(settings.currency)}</Row>
      </Section>

      <Section title="Brand">
        <Row label="Logo">
          {settings.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user upload on Supabase Storage
            <img
              src={settings.logoUrl}
              alt={`${settings.name} logo`}
              className="size-12 rounded-lg object-contain"
            />
          ) : (
            <span className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-12 items-center justify-center rounded-lg bg-primary-tint text-label text-primary-tint-foreground"
              >
                {initialsOf(settings.name)}
              </span>
              No logo yet: initials are shown.
            </span>
          )}
        </Row>
        <Row label="Brand colour">
          <span className="flex items-center gap-3">
            <span
              aria-hidden
              className="size-6 rounded-full border"
              style={{ backgroundColor: settings.brandColor }}
            />
            <span className="font-mono text-mono tabular-nums">{settings.brandColor}</span>
          </span>
        </Row>
      </Section>

      <Section title="Opening hours" empty={week ? undefined : "Opening hours aren’t set yet."}>
        {week?.map((day) => (
          <Row key={day.weekday} label={WEEKDAY_NAMES[day.weekday] ?? ""}>
            <span className="font-mono text-mono tabular-nums">
              {day.open ? day.ranges.map((r) => `${r.start} – ${r.end}`).join(", ") : "Closed"}
            </span>
          </Row>
        ))}
      </Section>

      <Section title="Booking rules">
        <Row label="Minimum notice">{formatNotice(settings.minNoticeMin)}</Row>
        <Row label="Book up to">
          <span className="font-mono text-mono tabular-nums">{settings.maxDaysAhead}</span> days
          ahead
        </Row>
        <Row label="Time slots">Every {settings.slotIntervalMin} minutes</Row>
        <Row label="Free cancellation">{formatCancellation(settings.cancellationWindowHours)}</Row>
      </Section>
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  /** Shown instead of the list when there's nothing to list. */
  empty?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-5 sm:p-8">
      <h2 className="text-title">{title}</h2>
      {empty ? (
        <p className="mt-3 py-3 text-body text-muted-foreground">{empty}</p>
      ) : (
        <dl className="mt-3 divide-y">{children}</dl>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-6">
      <dt className="text-body-sm text-muted-foreground sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 text-body">{children}</dd>
    </div>
  );
}

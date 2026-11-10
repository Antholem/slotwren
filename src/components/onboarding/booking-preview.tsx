import { Check } from "lucide-react";

import { INK, initialsOf, readableTextOn, tint } from "@/lib/color";
import { formatPrice } from "@/lib/money";

export type PreviewProps = {
  host: string; // "slotwren.com"
  slug: string;
  name: string;
  brandColor: string;
  logoUrl: string | null;
  hoursLabel: string; // "Open today 9:00 – 18:00"
  service: { name: string; durationMin: number | null; priceCents: number | null } | null;
  currency: string;
};

const CHIPS = ["09:00", "09:30", "10:00", "10:30"];

/**
 * A miniature of the public booking page in the owner's brand. Purely
 * illustrative, so it's hidden from assistive tech; the form beside it holds
 * every value it shows.
 */
export function BookingPreview(props: PreviewProps) {
  const { host, slug, name, brandColor, logoUrl, hoursLabel, service, currency } = props;
  const soft = tint(brandColor, 0.88);
  const onBrand = readableTextOn(brandColor);
  // The tile and chips sit on light backgrounds; very light brand colours
  // fall back to ink so the preview stays legible.
  const brandText = readableTextOn(brandColor) === INK ? INK : brandColor;

  return (
    <div aria-hidden className="overflow-hidden rounded-[1.75rem] border bg-card shadow-md">
      <div className="truncate border-b px-6 py-4 text-center font-mono text-mono-sm text-muted-foreground">
        {host}/b/{slug || "your-business"}
      </div>
      <div className="flex flex-col gap-5 bg-background p-6 text-foreground">
        <div
          className="flex size-14 items-center justify-center overflow-hidden rounded-xl text-title"
          style={{ backgroundColor: soft, color: brandText }}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user upload on Supabase Storage
            <img src={logoUrl} alt="" className="size-full object-contain" />
          ) : (
            initialsOf(name) || "SW"
          )}
        </div>
        <div>
          <p className="text-heading break-words">{name || "Your business"}</p>
          <p className="mt-1 text-body-sm text-muted-foreground">{hoursLabel}</p>
        </div>
        <p className="text-label">Choose a service</p>
        <div
          className="flex items-center justify-between gap-3 rounded-xl border-2 px-4 py-3"
          // The tint is always light, so its text is ink in dark mode too.
          style={{ backgroundColor: soft, borderColor: brandColor, color: INK }}
        >
          <div className="min-w-0">
            <p className="truncate text-label">{service?.name || "Your first service"}</p>
            <p className="font-mono text-mono-sm tabular-nums">
              {service?.durationMin ? `${service.durationMin} min` : "– min"} ·{" "}
              {service?.priceCents != null ? formatPrice(service.priceCents, currency) : "$–"}
            </p>
          </div>
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: brandColor, color: onBrand }}
          >
            <Check className="size-4" strokeWidth={3} />
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {CHIPS.map((chip, i) => (
            <span
              key={chip}
              className="rounded-lg border py-2 text-center font-mono text-mono-sm tabular-nums"
              style={
                i === 1
                  ? { backgroundColor: brandColor, borderColor: brandColor, color: onBrand }
                  : undefined
              }
            >
              {chip}
            </span>
          ))}
        </div>
        <span
          className="rounded-lg py-3 text-center text-label"
          style={{ backgroundColor: brandColor, color: onBrand }}
        >
          Continue
        </span>
      </div>
    </div>
  );
}

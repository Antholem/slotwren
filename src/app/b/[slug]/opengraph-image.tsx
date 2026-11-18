import { ImageResponse } from "next/og";

import { initialsOf, readableTextOn } from "@/lib/color";
import { formatPrice } from "@/lib/money";
import { SLUG_PATTERN } from "@/lib/slug";
import { getBookingPage } from "@/server/db/queries/public/booking-page";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";

/*
 * The preview a shared booking link unfurls into (WhatsApp, Messenger, Slack,
 * iMessage): the business in its colour and logo, what you can book, and
 * "Book online". Public fields only, the same ones the page shows.
 */

export const alt = "Online booking page";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#1C1917";
const MUTED = "#57534E";

/** The logo as a data URL, or null if it can't be fetched quickly. */
async function logoData(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !/^image\/(png|jpeg|webp|svg\+xml)/.test(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = SLUG_PATTERN.test(slug) ? await getPublicBusinessBySlug(slug) : null;
  const data = found ? await getBookingPage(found.id) : null;
  const name = data?.business.name ?? "Slotwren";
  const brand = data?.business.brandColor ?? "#0F766E";
  const logo = await logoData(data?.business.logoUrl ?? null);
  const services = (data?.services ?? []).slice(0, 3);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#FAFAF9",
        color: INK,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ height: 16, width: "100%", backgroundColor: brand }} />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", padding: "64px 80px 56px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <div
            style={{
              width: 128,
              height: 128,
              borderRadius: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              backgroundColor: logo ? "#FFFFFF" : brand,
              color: readableTextOn(brand),
              fontSize: 52,
              fontWeight: 600,
            }}
          >
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- rendered by ImageResponse
              <img src={logo} alt="" width={128} height={128} style={{ objectFit: "contain" }} />
            ) : (
              initialsOf(name)
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05 }}>{name}</div>
            {data?.business.address && (
              <div style={{ fontSize: 30, color: MUTED }}>{data.business.address}</div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 56 }}>
          {services.map((service) => (
            <div key={service.id} style={{ display: "flex", fontSize: 34, color: INK }}>
              <span>{service.name}</span>
              <span style={{ color: MUTED, marginLeft: 16 }}>
                {service.durationMin} min ·{" "}
                {formatPrice(service.priceCents, data!.business.currency)}
              </span>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              padding: "18px 36px",
              borderRadius: 20,
              backgroundColor: brand,
              color: readableTextOn(brand),
              fontSize: 34,
              fontWeight: 600,
            }}
          >
            Book online
          </div>
          <div style={{ fontSize: 28, color: MUTED }}>Powered by Slotwren</div>
        </div>
      </div>
    </div>,
    size,
  );
}

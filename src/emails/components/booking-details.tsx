import { BrandLink, type DetailRow, type EmailBusiness } from "./email-shell";

/** What every booking email says about the appointment, already formatted. */
export type BookingEmailData = {
  business: EmailBusiness;
  customerName: string;
  serviceName: string;
  durationMin: number;
  staffName: string;
  /** "$35", "Free" */
  price: string;
  code: string;
  /** "Saturday, 31 October" on the customer's clock. */
  date: string;
  /** "10:30 – 11:15" */
  range: string;
  /** "Times in GMT+8 (Asia/Manila)", when that isn't obvious. */
  zoneNote: string | null;
  mapsUrl: string | null;
  /** Replies reach the business (a contact email, or its owners'). */
  canReply: boolean;
};

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export function detailRows(data: BookingEmailData): DetailRow[] {
  return [
    { label: "Service", value: `${data.serviceName} · ${data.durationMin} min` },
    { label: "With", value: data.staffName },
    { label: "Price", value: data.price },
    ...(data.business.address
      ? [
          {
            label: "Where",
            value: (
              <>
                {data.business.address}
                {data.mapsUrl && (
                  <>
                    <br />
                    <BrandLink href={data.mapsUrl} brandColor={data.business.brandColor}>
                      Open in Maps
                    </BrandLink>
                  </>
                )}
              </>
            ),
          },
        ]
      : []),
    { label: "Booking code", value: data.code, mono: true },
  ];
}

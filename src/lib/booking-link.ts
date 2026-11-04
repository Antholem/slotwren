import { clientEnv } from "@/env";

/** Host shown in booking links: "slotwren.com", "localhost:3000". */
export const bookingHost = () => new URL(clientEnv.NEXT_PUBLIC_APP_URL).host;

/** The public booking page for a business. */
export const bookingUrl = (slug: string) =>
  new URL(`/b/${slug}`, clientEnv.NEXT_PUBLIC_APP_URL).toString();

/** "slotwren.com/b/lumen-studio", for display. */
export const bookingLinkLabel = (slug: string) => `${bookingHost()}/b/${slug}`;

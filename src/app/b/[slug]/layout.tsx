import { Suspense } from "react";

import { EmbedBridge } from "@/components/booking/embed-bridge";

/** The booking page and its confirmation; inside the website widget, the bridge talks to the host page. */
export default function BookingLayout({ children }: LayoutProps<"/b/[slug]">) {
  return (
    <>
      {children}
      {/* It reads the URL (embedded? which page?): nothing to render on the server. */}
      <Suspense fallback={null}>
        <EmbedBridge />
      </Suspense>
    </>
  );
}

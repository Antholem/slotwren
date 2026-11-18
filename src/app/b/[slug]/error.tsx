"use client";

import { RouteError } from "@/components/shared/route-error";

/** The booking page failed to load: customers aren't signed in, so just retry. */
export default function BookingError(props: { error: unknown; retry: () => void }) {
  return (
    <RouteError
      {...props}
      message="The booking page didn't load. Check your connection and try again."
    />
  );
}

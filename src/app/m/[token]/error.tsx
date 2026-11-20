"use client";

import { RouteError } from "@/components/shared/route-error";

/** The manage page failed to load: customers aren't signed in, so just retry. */
export default function ManageError(props: { error: unknown; retry: () => void }) {
  return (
    <RouteError
      {...props}
      message="Your booking didn't load. Check your connection and try again."
    />
  );
}

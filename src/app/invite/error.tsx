"use client";

import { RouteError } from "@/components/shared/route-error";

export default function InviteError(props: { error: unknown; retry: () => void }) {
  return <RouteError {...props} />;
}

"use client";

import { RouteError } from "@/components/shared/route-error";

export default function DashboardError(props: { error: unknown; retry: () => void }) {
  return <RouteError {...props} />;
}

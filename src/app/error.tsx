"use client";

import { RouteError } from "@/components/shared/route-error";

/**
 * Anything below the root layout that no closer error.tsx catches, including
 * a nested layout's own failure (a layout's error.tsx sits inside it). Keeps
 * the root layout's styles and theme; global-error.tsx is only for the root
 * layout itself.
 */
export default function RootError(props: { error: unknown; retry: () => void }) {
  return (
    <RouteError {...props} message="This page didn't load. Check your connection and try again." />
  );
}

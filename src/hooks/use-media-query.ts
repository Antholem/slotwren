"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches. `serverValue` is used for the server
 * render and hydration, so pick the layout that's safest to show first.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

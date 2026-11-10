"use client";

import { useEffect } from "react";

/**
 * Marks <body data-sticky-bar> while a page shows a sticky bar at the bottom
 * (Settings' Save bar), so bottom toasts lift above it instead of covering it.
 */
export function useStickyBar() {
  useEffect(() => {
    document.body.dataset.stickyBar = "";
    return () => {
      delete document.body.dataset.stickyBar;
    };
  }, []);
}

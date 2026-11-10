"use client";

import { Toaster } from "sonner";

import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * Dashboard toasts: bottom-right on desktop (as in the Today mockup), top on
 * phones so they don't cover the list and its buttons. Token colours, because
 * sonner's richColors palette fails AA contrast. Pages with a sticky save bar
 * mark <body data-sticky-bar> (useStickyBar), and bottom toasts sit above it
 * wherever it rests (stuck to the viewport, or in flow at the end of the page).
 */
export function AppToaster() {
  const desktop = useMediaQuery("(min-width: 768px)", true);
  return (
    <Toaster
      position={desktop ? "bottom-right" : "top-center"}
      closeButton
      className="in-data-sticky-bar:data-[y-position=bottom]:!bottom-[8.75rem]"
      toastOptions={{
        classNames: {
          toast: "!bg-card !text-card-foreground !border-border !text-body-sm",
          description: "!text-muted-foreground",
          closeButton: "!bg-card !text-foreground !border-border",
        },
      }}
    />
  );
}

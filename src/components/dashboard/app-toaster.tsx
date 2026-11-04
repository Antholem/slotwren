"use client";

import { Toaster } from "sonner";

import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * Dashboard toasts: bottom-right on desktop (as in the Today mockup), top on
 * phones so they don't cover the list and its buttons. Token colours, because
 * sonner's richColors palette fails AA contrast.
 */
export function AppToaster() {
  const desktop = useMediaQuery("(min-width: 768px)", true);
  return (
    <Toaster
      position={desktop ? "bottom-right" : "top-center"}
      closeButton
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

"use client";

import { AlertCircle } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Body for a segment's error.tsx: a calm message and a retry. */
export function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Sentry picks this up once it's wired in (Phase 5).
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger-text">
        <AlertCircle aria-hidden className="size-6" />
      </span>
      <h1 className="text-title">Something went wrong</h1>
      <p className="max-w-sm text-body-sm text-muted-foreground">
        This page didn&rsquo;t load. Try again, and if it keeps happening, sign out and back in.
      </p>
      <Button onClick={() => retry()} className="h-11 px-4 text-label">
        Try again
      </Button>
    </main>
  );
}

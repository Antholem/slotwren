"use client";

import "./globals.css";

import { AlertCircle } from "lucide-react";
import { useEffect } from "react";

import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { THEME_SCRIPT } from "@/lib/theme";

/*
 * When the root layout itself fails. This replaces the whole document, so it
 * brings its own <html>, styles and theme (the root layout's don't apply).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Sentry picks this up once it's wired in (Phase 5).
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <title>Something went wrong · Slotwren</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
          <Logo />
          <span className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger-text">
            <AlertCircle aria-hidden className="size-6" />
          </span>
          <div className="flex max-w-md flex-col gap-2">
            <h1 className="text-heading">Something went wrong</h1>
            <p className="text-body text-muted-foreground">
              Slotwren didn&rsquo;t load. Try again; if it keeps happening, come back in a few
              minutes.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={() => retry()} className="h-11 px-5 text-label">
              Try again
            </Button>
            <Button asChild variant="secondary" className="h-11 px-5 text-label">
              {/* A full page load, since the app shell is what failed. */}
              <a href="/">Go to the home page</a>
            </Button>
          </div>
        </main>
      </body>
    </html>
  );
}

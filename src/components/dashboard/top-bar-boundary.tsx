"use client";

import { Menu, RotateCw } from "lucide-react";
import { catchError, type ErrorInfo } from "next/error";
import { useEffect, useState } from "react";

import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { NavList } from "./nav-list";

const focusRing = "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * The top bar when the session lookup behind it fails (the database is
 * unreachable, say): a plain bar that keeps the menu on phones, says what
 * happened and offers a retry, so the dashboard shell and the page's own
 * error state stay on screen instead of the app-wide error page. Redirects
 * (signed out, no business yet) pass through catchError untouched.
 */
function TopBarFallback(_props: object, { error, retry }: ErrorInfo) {
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    // Sentry picks this up once it's wired in (Phase 5).
    console.error(error);
  }, [error]);

  return (
    <header
      data-testid="top-bar-fallback"
      className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card px-4 sm:px-6 lg:h-20 lg:px-8"
    >
      <button
        type="button"
        onClick={() => setNavOpen(true)}
        aria-label="Open menu"
        className={cn(
          "-ml-2 flex size-11 items-center justify-center rounded-lg lg:hidden",
          focusRing,
        )}
      >
        <Menu aria-hidden className="size-6" />
      </button>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-80 gap-0 p-4 sm:max-w-80">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="mb-4 flex h-11 items-center px-2">
            <Logo href={null} />
          </div>
          <nav aria-label="Dashboard">
            <NavList onNavigate={() => setNavOpen(false)} />
          </nav>
        </SheetContent>
      </Sheet>
      <p className="min-w-0 flex-1 truncate text-body-sm text-muted-foreground">
        Couldn&rsquo;t load your account details.
      </p>
      <Button
        type="button"
        variant="secondary"
        onClick={() => retry()}
        className="h-11 shrink-0 px-4 text-label"
      >
        <RotateCw aria-hidden />
        Try again
      </Button>
      <form action="/auth/sign-out" method="post" className="shrink-0">
        <Button type="submit" variant="ghost" className="h-11 px-4 text-label">
          Sign out
        </Button>
      </form>
    </header>
  );
}

export const TopBarBoundary = catchError(TopBarFallback);

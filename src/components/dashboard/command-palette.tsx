"use client";

import { CalendarClock, FileText, Search, User } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatInZone } from "@/lib/dates";
import { cn } from "@/lib/utils";

import { NAV_ITEMS } from "./nav-items";

export type PaletteResults = {
  customers: { id: string; name: string; email: string }[];
  bookings: { id: string; code: string; customerName: string; startsAt: Date }[];
};

export type PaletteSearch = (query: string) => Promise<PaletteResults>;

const PAGES: { label: string; href: Route; keywords?: string }[] = [
  ...NAV_ITEMS.filter((item) => item.href).map((item) => ({
    label: item.label,
    href: item.href!,
  })),
  { label: "Your booking link", href: "/app/live" as Route, keywords: "share qr code" },
  {
    label: "Settings: Booking page",
    href: "/app/settings/booking-page" as Route,
    keywords: "brand",
  },
  {
    label: "Settings: Notifications",
    href: "/app/settings/notifications" as Route,
    keywords: "email",
  },
  { label: "Settings: Embed", href: "/app/settings/embed" as Route, keywords: "widget website" },
  { label: "Settings: Billing", href: "/app/settings/billing" as Route, keywords: "plan stripe" },
];

const focusRing = "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * The top bar's search (⌘K / Ctrl+K): customers by name or email, bookings by
 * code, and pages, in the current business only (the search runs on the
 * server for the business in the session). cmdk gives the combobox: arrow
 * keys move, Enter opens, Escape closes.
 */
export function CommandPalette({ search, zone }: { search: PaletteSearch; zone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; results: PaletteResults } | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const term = query.trim();
  useEffect(() => {
    if (term.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      search(term)
        .then((results) => live && setFound({ query: term, results }))
        .catch(() => live && setFound({ query: term, results: { customers: [], bookings: [] } }));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term, search]);

  const results = found?.query === term ? found.results : null;
  const searching = term.length >= 2 && !results;
  const lower = term.toLowerCase();
  const pages = PAGES.filter(
    (p) => !lower || `${p.label} ${p.keywords ?? ""}`.toLowerCase().includes(lower),
  );

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href as Route);
  }

  const time = (date: Date) => formatInZone(date, zone, "EEE d MMM, HH:mm");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          "hidden h-11 w-full max-w-xl items-center gap-3 rounded-xl border border-input bg-background px-4 text-left text-body text-muted-foreground hover:bg-muted lg:flex",
          focusRing,
        )}
      >
        <Search aria-hidden className="size-5" />
        <span className="flex-1">Search bookings, customers, pages</span>
        <kbd className="rounded-md border bg-card px-2 py-0.5 font-mono text-caption text-foreground">
          ⌘K
        </kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className={cn(
          "flex size-11 items-center justify-center rounded-full hover:bg-muted lg:hidden",
          focusRing,
        )}
      >
        <Search aria-hidden className="size-5" />
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Find customers by name or email, bookings by code, and pages.
          </DialogDescription>
          <Command shouldFilter={false} label="Search">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search customers, booking codes, pages"
              aria-label="Search customers, booking codes, pages"
            />
            <CommandList>
              {searching && (
                <p className="px-3 py-2 text-body-sm text-muted-foreground" aria-live="polite">
                  Searching…
                </p>
              )}
              <CommandEmpty>Nothing matches &ldquo;{term}&rdquo;.</CommandEmpty>
              {results && results.customers.length > 0 && (
                <CommandGroup heading="Customers">
                  {results.customers.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`customer-${c.id}`}
                      onSelect={() => go(`/app/customers/${c.id}`)}
                    >
                      <User aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="truncate text-body-sm text-muted-foreground group-data-[selected=true]:text-primary-tint-foreground">
                        {c.email}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {results && results.bookings.length > 0 && (
                <CommandGroup heading="Bookings">
                  {results.bookings.map((b) => (
                    <CommandItem
                      key={b.id}
                      value={`booking-${b.id}`}
                      onSelect={() =>
                        go(
                          `/app/bookings?range=all&q=${encodeURIComponent(b.code)}&booking=${b.id}`,
                        )
                      }
                    >
                      <CalendarClock aria-hidden />
                      <span className="font-mono tabular-nums">{b.code}</span>
                      <span className="min-w-0 flex-1 truncate">{b.customerName}</span>
                      <span className="text-body-sm text-muted-foreground group-data-[selected=true]:text-primary-tint-foreground">
                        {time(b.startsAt)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {pages.length > 0 && (
                <CommandGroup heading="Pages">
                  {pages.map((p) => (
                    <CommandItem key={p.href} value={`page-${p.href}`} onSelect={() => go(p.href)}>
                      <FileText aria-hidden />
                      {p.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

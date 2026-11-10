"use client";

import { ChevronDown, ChevronsUpDown, Menu, Monitor, Moon, Sun, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Logo } from "@/components/shared/logo";
import { useThemePreference } from "@/components/shared/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { initialsOf } from "@/lib/color";
import { saveThemePreference, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

import { NavList } from "./nav-list";
import { titleFor } from "./nav-items";

export type TopBarProps = {
  business: { id: string; name: string; logoUrl: string | null };
  businesses: { id: string; name: string }[];
  role: "owner" | "staff";
  email: string | null;
  switchBusiness: (businessId: string) => Promise<void>;
};

const focusRing = "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export function TopBar(props: TopBarProps) {
  const { business } = props;
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card px-4 sm:px-6 lg:h-20 lg:px-8">
      {/* Mobile: menu, business + page title, user */}
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
      <div className="min-w-0 flex-1 lg:hidden">
        <p className="truncate text-body-sm text-muted-foreground">{business.name}</p>
        <p className="truncate text-title">{titleFor(pathname)}</p>
      </div>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-80 gap-0 p-4 sm:max-w-80">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="mb-4 flex h-11 items-center px-2">
            <Logo href={null} />
          </div>
          <BusinessSwitcher {...props} className="mb-4 w-full" />
          <nav aria-label="Dashboard">
            <NavList onNavigate={() => setNavOpen(false)} />
          </nav>
        </SheetContent>
      </Sheet>

      {/* Desktop: business switcher */}
      <BusinessSwitcher {...props} className="hidden lg:flex" />
      <div className="hidden flex-1 lg:block" />

      <UserMenu role={props.role} email={props.email} />
    </header>
  );
}

function BusinessTile({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary-tint text-label text-primary-tint-foreground">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user upload on Supabase Storage
        <img src={logoUrl} alt="" className="size-full object-contain" />
      ) : (
        <span aria-hidden>{initialsOf(name)}</span>
      )}
    </span>
  );
}

function BusinessSwitcher({
  business,
  businesses,
  switchBusiness,
  className,
}: TopBarProps & { className?: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex min-h-11 max-w-72 items-center gap-3 rounded-xl border bg-card py-1.5 pr-3 pl-1.5 text-left hover:bg-muted disabled:opacity-60",
          focusRing,
          className,
        )}
        disabled={pending}
        aria-label={`Business: ${business.name}. Switch business`}
      >
        <BusinessTile name={business.name} logoUrl={business.logoUrl} />
        <span className="min-w-0 flex-1 truncate text-label">{business.name}</span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your businesses</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={business.id}
          onValueChange={(id) => {
            if (id !== business.id) startTransition(() => switchBusiness(id));
          }}
        >
          {businesses.map((b) => (
            <DropdownMenuRadioItem key={b.id} value={b.id} className="min-h-11">
              {b.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

function UserMenu({ role, email }: { role: "owner" | "staff"; email: string | null }) {
  const signOutForm = useRef<HTMLFormElement>(null);
  const roleLabel = role === "owner" ? "Owner" : "Staff";
  const theme = useThemePreference();

  return (
    <>
      <form ref={signOutForm} action="/auth/sign-out" method="post" className="hidden" />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Account (${roleLabel})`}
          className={cn(
            "flex min-h-11 items-center gap-2 rounded-full pr-2 hover:bg-muted",
            focusRing,
          )}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-muted">
            <User aria-hidden className="size-5" />
          </span>
          <span className="hidden text-label lg:inline">{roleLabel}</span>
          <ChevronDown aria-hidden className="hidden size-4 text-muted-foreground lg:block" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <span className="block text-caption text-muted-foreground">Signed in as</span>
            <span className="block truncate text-label">{email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="min-h-11">
            <Link href="/app/live">Your booking link</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-caption font-normal text-muted-foreground">
            Theme
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => saveThemePreference(value as ThemePreference)}
          >
            {THEMES.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value} className="min-h-11">
                <Icon aria-hidden className="size-4" />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="min-h-11"
            onSelect={() => signOutForm.current?.requestSubmit()}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function TopBarSkeleton() {
  return (
    <div className="flex h-16 items-center gap-3 border-b bg-card px-4 lg:h-20 lg:px-8">
      <div className="h-11 w-56 animate-pulse rounded-xl bg-muted" />
      <div className="flex-1" />
      <div className="size-11 animate-pulse rounded-full bg-muted" />
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { cn } from "@/lib/utils";

import { isCurrent, NAV_ITEMS } from "./nav-items";

type NavListProps = { collapsed?: boolean; onNavigate?: () => void };

/**
 * The dashboard's sections, with the current one marked. usePathname waits
 * for request data on pages with a dynamic segment (/app/customers/[id]), so
 * the list sits in Suspense; until then it shows without a current item.
 */
export function NavList(props: NavListProps) {
  return (
    <Suspense fallback={<NavItems {...props} pathname={null} />}>
      <CurrentNavItems {...props} />
    </Suspense>
  );
}

function CurrentNavItems(props: NavListProps) {
  return <NavItems {...props} pathname={usePathname()} />;
}

/** Collapsed: icons only, names kept for screen readers. */
function NavItems({
  collapsed = false,
  onNavigate,
  pathname,
}: NavListProps & { pathname: string | null }) {
  return (
    <ul className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const current = pathname !== null && isCurrent(item, pathname);
        const body = (
          <>
            <Icon aria-hidden className="size-5 shrink-0" />
            <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
          </>
        );
        const base = cn(
          "flex min-h-11 items-center gap-3 rounded-lg px-3 text-body",
          collapsed && "justify-center px-0",
        );

        return (
          <li key={item.label}>
            {item.href ? (
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={current ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  base,
                  "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  current
                    ? "bg-primary-tint font-medium text-primary-tint-foreground"
                    : "text-foreground hover:bg-muted",
                )}
              >
                {body}
              </Link>
            ) : (
              <span
                aria-disabled="true"
                title={collapsed ? `${item.label} (coming soon)` : undefined}
                className={cn(base, "text-muted-foreground")}
              >
                {body}
                {!collapsed && (
                  <span className="ml-auto rounded-full border px-2 py-0.5 text-caption">Soon</span>
                )}
                {collapsed && <span className="sr-only"> (coming soon)</span>}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

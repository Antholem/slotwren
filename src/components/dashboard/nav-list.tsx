"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { isCurrent, NAV_ITEMS } from "./nav-items";

/** The dashboard's sections. Collapsed: icons only, names kept for screen readers. */
export function NavList({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const current = isCurrent(item, pathname);
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

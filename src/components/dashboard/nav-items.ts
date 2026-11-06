import {
  Calendar,
  ChartLine,
  ClipboardList,
  House,
  type LucideIcon,
  Scissors,
  Settings,
  Sparkle,
  User,
  Users,
} from "lucide-react";
import type { Route } from "next";

export type NavItem = {
  label: string;
  icon: LucideIcon;
  /** null until the page is built: shown, but not a link. */
  href: Route | null;
  /** Path prefixes that mark this item as current. */
  match?: string[];
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Today", icon: House, href: "/app", match: ["/app/live"] },
  { label: "Calendar", icon: Calendar, href: null },
  { label: "Bookings", icon: ClipboardList, href: null },
  { label: "Customers", icon: Users, href: null },
  { label: "Services", icon: Scissors, href: "/app/services" },
  { label: "Staff", icon: User, href: "/app/staff" },
  { label: "AI receptionist", icon: Sparkle, href: null },
  { label: "Insights", icon: ChartLine, href: null },
  { label: "Settings", icon: Settings, href: "/app/settings/embed", match: ["/app/settings"] },
];

export function isCurrent(item: NavItem, pathname: string) {
  if (!item.href) return false;
  if (item.href === "/app") {
    return pathname === "/app" || (item.match ?? []).some((p) => pathname.startsWith(p));
  }
  return [item.href, ...(item.match ?? [])].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** The page title for the mobile header. */
export function titleFor(pathname: string) {
  if (pathname.startsWith("/app/live")) return "You're live";
  return NAV_ITEMS.find((item) => isCurrent(item, pathname))?.label ?? "Dashboard";
}

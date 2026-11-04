"use client";

import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";

import { Logo, SlotwrenMark } from "@/components/shared/logo";
import { cn } from "@/lib/utils";

import { NavList } from "./nav-list";

const STORAGE_KEY = "sw-sidebar-collapsed";

/** Desktop sidebar (lg and up). Collapses to icons; the choice is remembered per browser. */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the saved preference after hydration
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  function toggle() {
    setCollapsed((value) => {
      window.localStorage.setItem(STORAGE_KEY, value ? "0" : "1");
      return !value;
    });
  }

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar px-3 py-5 transition-[width] lg:flex",
        collapsed ? "w-20" : "w-64",
      )}
    >
      <div className={cn("mb-6 flex h-10 items-center", collapsed ? "justify-center" : "px-3")}>
        {collapsed ? <SlotwrenMark /> : <Logo href={null} />}
      </div>
      <nav aria-label="Dashboard" className="flex-1 overflow-y-auto">
        <NavList collapsed={collapsed} />
      </nav>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-lg px-3 text-body text-muted-foreground hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          collapsed && "justify-center px-0",
        )}
      >
        <PanelLeft aria-hidden className="size-5" />
        <span className={cn(collapsed && "sr-only")}>
          {collapsed ? "Expand sidebar" : "Collapse"}
        </span>
      </button>
    </aside>
  );
}

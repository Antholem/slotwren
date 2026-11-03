import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Posts to /auth/sign-out. A plain form, so it works before hydration too.
 * `compact` shows only the icon below the sm breakpoint (the label stays for
 * screen readers).
 */
export function SignOutButton({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <form action="/auth/sign-out" method="post" className={className}>
      <Button type="submit" variant="ghost" className="h-11 min-w-11 px-3 text-label">
        <LogOut aria-hidden />
        <span className={compact ? "sr-only sm:not-sr-only" : undefined}>Sign out</span>
      </Button>
    </form>
  );
}

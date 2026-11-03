import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Posts to /auth/sign-out. A plain form, so it works before hydration too. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/sign-out" method="post" className={className}>
      <Button type="submit" variant="ghost" className="h-11 px-3 text-label">
        <LogOut aria-hidden />
        Sign out
      </Button>
    </form>
  );
}

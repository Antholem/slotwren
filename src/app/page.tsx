import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";

// Interim home page until the landing page (Phase 5): what Slotwren is, and a
// way in. One email link both signs in and creates an account.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-16 text-center">
      <Logo href={null} />
      <div className="flex max-w-xl flex-col gap-3">
        <h1 className="text-heading sm:text-display">Your front desk, open 24/7</h1>
        <p className="text-body text-muted-foreground">
          Online booking, reminders and an AI receptionist for small service businesses. Set up in
          10 minutes, embed anywhere.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild className="h-11 px-5 text-label">
          <Link href="/sign-in">
            Get started
            <ArrowRight aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="secondary" className="h-11 px-5 text-label">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}

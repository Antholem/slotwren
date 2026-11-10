import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

/** Every 404, including a booking link whose business doesn't exist. */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <Logo />
      <div className="flex max-w-md flex-col gap-2">
        <p className="font-mono text-mono text-muted-foreground tabular-nums">404</p>
        <h1 className="text-heading">We can&rsquo;t find that page</h1>
        <p className="text-body text-muted-foreground">
          The link may have a typo, or the page may have moved. If a business sent you a booking
          link, ask them for the latest one.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild className="h-11 px-5 text-label">
          <Link href="/">Go to the home page</Link>
        </Button>
        <Button asChild variant="secondary" className="h-11 px-5 text-label">
          <Link href="/app">Open your dashboard</Link>
        </Button>
      </div>
    </main>
  );
}

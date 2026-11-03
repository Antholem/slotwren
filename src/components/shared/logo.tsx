import { Bird } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/** Slotwren wordmark. Links home; pass `href={null}` for a plain mark. */
export function Logo({ className, href = "/" }: { className?: string; href?: "/" | null }) {
  const mark = (
    <>
      <Bird aria-hidden className="size-7 text-primary" strokeWidth={2.25} />
      <span className="text-title text-foreground">Slotwren</span>
    </>
  );

  if (href === null) {
    return <span className={cn("inline-flex items-center gap-2", className)}>{mark}</span>;
  }

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      {mark}
    </Link>
  );
}

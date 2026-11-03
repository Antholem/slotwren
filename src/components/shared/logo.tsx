import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The Slotwren mark, inlined from public/brand/slotwren-mark.svg so it takes
 * `currentColor`: text-primary gives the brand teal in light mode and the
 * on-dark teal (#2DD4BF, slotwren-mark-on-dark.svg) in dark mode.
 */
export function SlotwrenMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className={cn("size-7 text-primary", className)}>
      <path
        fill="currentColor"
        d="M12.25 12.5H16.75A8.25 8.25 0 0 1 25 20.75V20.75A8.25 8.25 0 0 1 16.75 29H12.25A8.25 8.25 0 0 1 4 20.75V20.75A8.25 8.25 0 0 1 12.25 12.5ZM16.6 11.8A5.6 5.6 0 1 1 27.8 11.8A5.6 5.6 0 1 1 16.6 11.8ZM26.6 10.3L31.8 12.3L26.6 14ZM5.4 19.5L2.2 4.6Q2 2.6 3.8 3.5L12.6 13.2ZM9.48 18.93A2.2 2.2 0 0 0 10.24 23.26L18.12 21.87A2.2 2.2 0 0 0 17.36 17.54ZM22.2 10.6A1.3 1.3 0 1 0 24.8 10.6A1.3 1.3 0 1 0 22.2 10.6Z"
      />
    </svg>
  );
}

/** Slotwren mark + wordmark. Links home; pass `href={null}` for a plain mark. */
export function Logo({ className, href = "/" }: { className?: string; href?: "/" | null }) {
  const mark = (
    <>
      <SlotwrenMark />
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

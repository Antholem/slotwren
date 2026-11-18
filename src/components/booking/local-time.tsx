"use client";

import { useCustomerTimeZone } from "@/hooks/use-customer-time-zone";
import { formatInZone } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * An instant on the customer's own clock ("Tue 27 Oct", "14:30"), formatted
 * after hydration (the server doesn't know their timezone). `pattern` is a
 * date-fns pattern; `placeholder` keeps the layout steady until then.
 */
export function LocalTime({
  value,
  pattern,
  placeholder = "",
  className,
}: {
  value: string | Date;
  pattern: string;
  placeholder?: string;
  className?: string;
}) {
  const zone = useCustomerTimeZone();
  const instant = typeof value === "string" ? new Date(value) : value;
  return (
    <time dateTime={instant.toISOString()} className={className}>
      {zone ? formatInZone(instant, zone, pattern) : placeholder}
    </time>
  );
}

/** A start–end range on the customer's clock: "14:30 – 15:15". */
export function LocalRange({
  start,
  end,
  className,
}: {
  start: string | Date;
  end: string | Date;
  className?: string;
}) {
  return (
    <span className={cn("font-mono whitespace-nowrap tabular-nums", className)}>
      <LocalTime value={start} pattern="HH:mm" placeholder="--:--" /> –{" "}
      <LocalTime value={end} pattern="HH:mm" placeholder="--:--" />
    </span>
  );
}

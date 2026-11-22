"use client";

import { Check, Copy, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BookingOptions } from "@/server/db/queries/calendar";

import { BookingSheet } from "../_booking/booking-sheet";

/** "Copy booking link", confirming in place and for screen readers. */
export function CopyLinkButton({
  url,
  label = "Copy booking link",
  variant = "secondary",
  className,
}: {
  url: string;
  label?: string;
  variant?: "secondary" | "default" | "link";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      toast.error("Couldn't copy the link", { description: url });
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        onClick={copy}
        className={cn(
          variant === "link"
            ? "h-11 px-0 text-label underline underline-offset-4"
            : "h-11 px-5 text-label",
          className,
        )}
      >
        {variant !== "link" && (copied ? <Check aria-hidden /> : <Copy aria-hidden />)}
        {copied ? "Copied" : label}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Booking link copied" : ""}
      </span>
    </>
  );
}

/** What the manual-booking sheet needs, passed down from the server page. */
export type NewBookingProps = {
  today: string;
  options: BookingOptions;
  currency: string;
  staffOnly: boolean;
};

/** "New booking": opens the manual-booking sheet for today. */
export function NewBookingButton({
  variant = "primary",
  today,
  options,
  currency,
  staffOnly,
}: NewBookingProps & { variant?: "primary" | "text" }) {
  const [open, setOpen] = useState(false);
  const sheet = (
    <BookingSheet
      open={open}
      onOpenChange={setOpen}
      start={{ date: today }}
      options={options}
      currency={currency}
      staffOnly={staffOnly}
    />
  );

  if (variant === "text") {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setOpen(true)}
          className="h-11 px-5 text-label"
        >
          Add a booking yourself
        </Button>
        {sheet}
      </>
    );
  }
  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="New booking"
        className="size-14 rounded-xl text-label sm:h-11 sm:w-auto sm:rounded-lg sm:px-5"
      >
        <Plus aria-hidden className="size-6 sm:size-4" />
        <span aria-hidden className="hidden sm:inline">
          New booking
        </span>
      </Button>
      {sheet}
    </>
  );
}

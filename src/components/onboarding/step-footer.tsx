import { Loader2 } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";

import { Button } from "@/components/ui/button";

/** Back (a link to the previous step) and the primary submit button. */
export function StepFooter({
  back,
  submitLabel = "Continue",
  pending,
}: {
  back?: Route;
  submitLabel?: string;
  pending: boolean;
}) {
  return (
    <div className="mt-8 flex items-center justify-between gap-4 border-t pt-6">
      {back ? (
        <Button asChild variant="secondary" className="h-11 px-5 text-label">
          <Link href={back}>Back</Link>
        </Button>
      ) : (
        <span />
      )}
      <Button
        type="submit"
        name="intent"
        value="continue"
        disabled={pending}
        className="h-11 px-6 text-label"
      >
        {pending && <Loader2 aria-hidden className="animate-spin" />}
        {submitLabel}
      </Button>
    </div>
  );
}

/** A field's error message, linked to its input with aria-describedby. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-body-sm text-danger-text">
      {message}
    </p>
  );
}

"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { acceptMyInviteAction } from "./actions";

/** "Accept and join Lumen Studio" for one invite found by the user's email. */
export function AcceptMyInvite({
  inviteId,
  businessName,
}: {
  inviteId: string;
  businessName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex w-full flex-col gap-3">
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-danger-soft px-4 py-3 text-left text-body-sm text-danger-text"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      <Button
        disabled={pending}
        className="h-11 w-full px-5 text-label"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await acceptMyInviteAction(inviteId);
            // Success redirects to the dashboard; only failures come back.
            if (!result.ok) setError(result.error.message);
          });
        }}
      >
        {pending && <Loader2 aria-hidden className="animate-spin" />}
        Accept and join {businessName}
      </Button>
    </div>
  );
}

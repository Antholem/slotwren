"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { acceptInviteAction } from "./actions";

/** Accept as the signed-in user, or switch account if it's the wrong one. */
export function AcceptInvite({
  token,
  businessName,
  signedInAs,
  emailHint,
}: {
  token: string;
  businessName: string;
  signedInAs: string | null;
  emailHint: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  function accept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInviteAction(token);
      // Success redirects to the dashboard; only failures come back.
      if (!result.ok) setError(result.error);
    });
  }

  const wrongAccount = error?.code === "wrong_account";

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-body-sm text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{signedInAs}</span>.
      </p>
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-danger-soft px-4 py-3 text-left text-body-sm text-danger-text"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {error.message}
            {wrongAccount && ` It was sent to ${emailHint}.`}
          </span>
        </p>
      )}
      {!wrongAccount && (
        <Button onClick={accept} disabled={pending} className="h-11 w-full px-5 text-label">
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Accept and join {businessName}
        </Button>
      )}
      <form action="/auth/sign-out" method="post">
        <input type="hidden" name="next" value={`/invite/${token}`} />
        <Button
          type="submit"
          variant={wrongAccount ? "default" : "ghost"}
          className="h-11 w-full px-5 text-label"
        >
          {wrongAccount ? "Sign out and switch account" : "Not you? Sign out"}
        </Button>
      </form>
    </div>
  );
}

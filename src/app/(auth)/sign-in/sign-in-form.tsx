"use client";

import { AlertCircle, Info, Loader2, Mail, MailCheck } from "lucide-react";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { type MagicLinkState, sendMagicLink, signInWithGoogle } from "../actions";

export type SignInNotice = { tone: "error" | "info"; message: string };

type Props = { googleEnabled: boolean; next?: string; notice: SignInNotice | null };

export function SignInForm({ googleEnabled, next, notice }: Props) {
  // Bumping the key resets the magic-link form for "Use a different email".
  const [attempt, setAttempt] = useState(0);

  return (
    <div className="mt-6 flex flex-col gap-6">
      {notice && attempt === 0 && <Notice notice={notice} />}
      <MagicLinkForm key={attempt} next={next} onReset={() => setAttempt((n) => n + 1)} />
      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-caption text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <form action={signInWithGoogle}>
            {next && <input type="hidden" name="next" value={next} />}
            <GoogleButton />
          </form>
        </>
      )}
    </div>
  );
}

function MagicLinkForm({ next, onReset }: { next?: string; onReset: () => void }) {
  const [state, formAction, pending] = useActionState<MagicLinkState, FormData>(
    sendMagicLink,
    null,
  );
  const [email, setEmail] = useState("");
  const emailId = useId();
  const errorId = useId();

  if (state?.ok) return <CheckYourEmail email={state.data.email} onReset={onReset} />;

  const error = state?.ok === false ? state.error : null;
  const fieldError = error?.code === "invalid_input";

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      {error && !fieldError && <Notice notice={{ tone: "error", message: error.message }} />}
      <div className="flex flex-col gap-2">
        <Label htmlFor={emailId} className="text-label">
          Email
        </Label>
        <Input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@yourbusiness.com"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={fieldError || undefined}
          aria-describedby={fieldError ? errorId : undefined}
          className="h-11 px-3 text-body md:text-body"
        />
        {fieldError && (
          <p id={errorId} className="text-body-sm text-danger-text">
            {error.message}
          </p>
        )}
      </div>
      <Button type="submit" disabled={pending} className="h-11 w-full text-label">
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Mail aria-hidden />}
        {pending ? "Sending link…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}

function CheckYourEmail({ email, onReset }: { email: string; onReset: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Move focus to the confirmation so screen readers announce it.
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-primary-tint text-primary-tint-foreground">
        <MailCheck aria-hidden className="size-6" />
      </span>
      <h2 ref={headingRef} tabIndex={-1} className="text-title outline-none">
        Check your email
      </h2>
      <p className="text-body-sm text-muted-foreground">
        We sent a sign-in link to <span className="font-medium text-foreground">{email}</span>. It
        works once and expires in 1 hour.
      </p>
      <Button type="button" variant="ghost" onClick={onReset} className="h-11 text-label">
        Use a different email
      </Button>
    </div>
  );
}

function GoogleButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className="h-11 w-full text-label">
      {pending ? <Loader2 aria-hidden className="animate-spin" /> : <GoogleIcon />}
      Continue with Google
    </Button>
  );
}

function Notice({ notice }: { notice: SignInNotice }) {
  const isError = notice.tone === "error";
  const Icon = isError ? AlertCircle : Info;
  return (
    <Alert
      role={isError ? "alert" : "status"}
      className={cn(
        "border-transparent",
        isError ? "bg-danger-soft text-danger-text" : "bg-info-soft text-info-text",
      )}
    >
      <Icon aria-hidden />
      <AlertDescription className="text-current">{notice.message}</AlertDescription>
    </Alert>
  );
}

export function SignInFormSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading sign-in options" className="mt-6 flex flex-col gap-4">
      <div className="h-5 w-12 animate-pulse rounded bg-muted" />
      <div className="h-11 animate-pulse rounded-lg bg-muted" />
      <div className="h-11 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

/** Google's "G" mark, in its brand colours as Google's guidelines require. */
function GoogleIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

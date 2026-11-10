import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { Logo } from "@/components/shared/logo";
import { isGoogleSignInEnabled } from "@/server/auth/providers";
import { hashToken } from "@/server/booking/tokens";
import { getInvitePreview } from "@/server/db/queries/public/invites";

import { type SignInNotice, SignInForm, SignInFormSkeleton } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

const NOTICES: Record<string, SignInNotice> = {
  link: {
    tone: "error",
    message: "That sign-in link has expired or was already used. Enter your email for a new one.",
  },
  cancelled: { tone: "error", message: "Google sign-in was cancelled." },
  google: {
    tone: "error",
    message: "Google sign-in isn't available right now. Use an email link instead.",
  },
};

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <main className="flex flex-1 flex-col items-center bg-background px-4 py-12 sm:py-20">
      <Logo className="mb-8" />
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <Suspense fallback={<SignInSkeleton />}>
          <SignIn searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

const INVITE_PATH = /^\/invite\/([A-Za-z0-9_-]{20,200})$/;

async function SignIn({ searchParams }: Pick<PageProps<"/sign-in">, "searchParams">) {
  const [params, googleEnabled] = await Promise.all([searchParams, isGoogleSignInEnabled()]);
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const next = first(params.next);

  const error = first(params.error);
  const notice: SignInNotice | null =
    (error && NOTICES[error]) ||
    (first(params.signed_out) ? { tone: "info", message: "You've signed out." } : null);

  // Arrived from "Sign in to accept": say whose invite, and send the link to
  // the address it went to (shown masked) without typing it.
  const token = next?.match(INVITE_PATH)?.[1];
  await connection(); // invite expiry depends on the current time
  const preview = token
    ? await getInvitePreview({ tokenHash: hashToken(token), now: new Date() })
    : null;
  const invite =
    token && preview?.status === "pending"
      ? { token, businessName: preview.businessName, emailHint: preview.emailHint }
      : null;

  return (
    <>
      {invite ? (
        <>
          <h1 className="text-heading">You&rsquo;ve been invited to join {invite.businessName}</h1>
          <p className="mt-1 text-body-sm text-muted-foreground">
            Sign in with the address your invite was sent to. New here? The same link creates your
            account.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-heading">Sign in to Slotwren</h1>
          <p className="mt-1 text-body-sm text-muted-foreground">
            We&rsquo;ll email you a link to sign in. New here? The same link creates your account.
          </p>
        </>
      )}
      <SignInForm googleEnabled={googleEnabled} next={next} notice={notice} invite={invite} />
    </>
  );
}

function SignInSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading sign-in">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-5 w-full animate-pulse rounded bg-muted" />
      <SignInFormSkeleton />
    </div>
  );
}

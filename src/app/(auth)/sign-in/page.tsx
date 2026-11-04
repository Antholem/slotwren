import type { Metadata } from "next";
import { Suspense } from "react";

import { Logo } from "@/components/shared/logo";
import { isGoogleSignInEnabled } from "@/server/auth/providers";

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
        <h1 className="text-heading">Sign in to Slotwren</h1>
        <p className="mt-1 text-body-sm text-muted-foreground">
          We&rsquo;ll email you a link to sign in. New here? The same link creates your account.
        </p>
        <Suspense fallback={<SignInFormSkeleton />}>
          <SignIn searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function SignIn({ searchParams }: Pick<PageProps<"/sign-in">, "searchParams">) {
  const [params, googleEnabled] = await Promise.all([searchParams, isGoogleSignInEnabled()]);
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const error = first(params.error);
  const notice: SignInNotice | null =
    (error && NOTICES[error]) ||
    (first(params.signed_out) ? { tone: "info", message: "You've signed out." } : null);

  return <SignInForm googleEnabled={googleEnabled} next={first(params.next)} notice={notice} />;
}

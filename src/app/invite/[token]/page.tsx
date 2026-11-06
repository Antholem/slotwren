import { CircleAlert, Clock, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { initialsOf } from "@/lib/color";
import { getCurrentUser } from "@/server/auth/session";
import { hashToken } from "@/server/booking/tokens";
import { getInvitePreview } from "@/server/db/queries/public/invites";

import { AcceptInvite } from "./accept-invite";

export const metadata: Metadata = {
  title: "Join your team",
  // Invite links are personal: keep them out of search results and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Where an invite email's link lands. Works signed in or out. */
export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <main className="flex flex-1 flex-col items-center bg-background px-4 py-12 sm:py-20">
      <Logo className="mb-8" />
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm sm:p-8">
        <Suspense fallback={<InviteSkeleton />}>
          <Invite params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Invite({ params }: Pick<PageProps<"/invite/[token]">, "params">) {
  const { token } = await params;
  await connection(); // expiry depends on the current time
  const preview = await getInvitePreview({ tokenHash: hashToken(token), now: new Date() });

  if (!preview) {
    return (
      <State
        icon={<CircleAlert className="size-6" />}
        tone="danger"
        title="This invite link isn't valid"
      >
        It may have been replaced by a newer invite or cancelled. Ask the person who invited you to
        send it again.
      </State>
    );
  }
  if (preview.status === "expired") {
    return (
      <State icon={<Clock className="size-6" />} tone="warning" title="This invite has expired">
        Invites last 7 days. Ask someone at {preview.businessName} to resend it.
      </State>
    );
  }

  const user = await getCurrentUser();
  if (preview.status === "accepted") {
    return (
      <State
        icon={<CircleAlert className="size-6" />}
        tone="info"
        title="This invite has been used"
      >
        {user ? (
          <Link href="/app" className="text-primary underline underline-offset-4">
            Go to your dashboard
          </Link>
        ) : (
          "Sign in with the account that accepted it."
        )}
      </State>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <span className="flex size-14 items-center justify-center overflow-hidden rounded-xl bg-primary-tint text-title text-primary-tint-foreground">
        {preview.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- user upload on Supabase Storage
          <img src={preview.logoUrl} alt="" className="size-full object-contain" />
        ) : (
          <span aria-hidden>{initialsOf(preview.businessName)}</span>
        )}
      </span>
      <h1 className="text-heading">Join {preview.businessName}</h1>
      <p className="text-body text-muted-foreground">
        Hi {preview.inviteeName}. You&rsquo;re invited as staff: you&rsquo;ll see the team calendar
        and manage your own bookings and hours.
      </p>
      {user ? (
        <AcceptInvite
          token={token}
          businessName={preview.businessName}
          signedInAs={user.email}
          emailHint={preview.emailHint}
        />
      ) : (
        <>
          <p className="text-body-sm text-muted-foreground">
            Sign in with the email the invite was sent to,{" "}
            <span className="font-medium text-foreground">{preview.emailHint}</span>. New to
            Slotwren? The same link creates your account.
          </p>
          <Button asChild className="h-11 w-full px-5 text-label">
            <Link href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}>
              <UserPlus aria-hidden />
              Sign in to accept
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}

function State({
  icon,
  tone,
  title,
  children,
}: {
  icon: ReactNode;
  tone: "danger" | "warning" | "info";
  title: string;
  children: ReactNode;
}) {
  const colours = {
    danger: "bg-danger-soft text-danger-text",
    warning: "bg-warning-soft text-warning-text",
    info: "bg-info-soft text-info-text",
  } as const;
  return (
    <div className="flex flex-col items-center gap-3">
      <span
        aria-hidden
        className={`flex size-12 items-center justify-center rounded-full ${colours[tone]}`}
      >
        {icon}
      </span>
      <h1 className="text-heading">{title}</h1>
      <p className="text-body text-muted-foreground">{children}</p>
    </div>
  );
}

function InviteSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading invite" className="flex flex-col items-center gap-4">
      <div className="size-14 animate-pulse rounded-xl bg-muted" />
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="h-12 w-full animate-pulse rounded bg-muted" />
      <div className="h-11 w-full animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

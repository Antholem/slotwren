import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { initialsOf } from "@/lib/color";
import { requireUser, rlsClaimsFor } from "@/server/auth/session";
import { listMyPendingInvites } from "@/server/db/queries/staff";

import { AcceptMyInvite } from "./accept-my-invite";

export const metadata: Metadata = {
  title: "You’ve been invited",
  robots: { index: false, follow: false },
};

/**
 * Invites waiting for the signed-in user's email. Onboarding sends new users
 * here first, so someone who opened their sign-in email on another device
 * (and lost the invite link) joins their team instead of creating a business.
 */
export default function MyInvitesPage() {
  return (
    <main className="flex flex-1 flex-col items-center bg-background px-4 py-12 sm:py-20">
      <Logo className="mb-8" />
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm sm:p-8">
        <Suspense fallback={<InvitesSkeleton />}>
          <MyInvites />
        </Suspense>
      </div>
    </main>
  );
}

async function MyInvites() {
  await connection(); // expiry depends on the current time
  const user = await requireUser();
  const invites = await listMyPendingInvites(rlsClaimsFor(user));
  if (invites.length === 0) redirect("/onboarding");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-heading">
          {invites.length === 1
            ? `You’ve been invited to join ${invites[0]!.businessName}`
            : "You’ve been invited"}
        </h1>
        <p className="text-body text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user.email}</span>. Join as
          staff to see the team calendar and manage your own bookings and hours.
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {invites.map((invite) => (
          <li
            key={invite.inviteId}
            className="flex flex-col items-center gap-3 rounded-xl border bg-background p-5"
          >
            <span className="flex size-12 items-center justify-center overflow-hidden rounded-xl bg-primary-tint text-title text-primary-tint-foreground">
              {invite.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- user upload on Supabase Storage
                <img src={invite.logoUrl} alt="" className="size-full object-contain" />
              ) : (
                <span aria-hidden>{initialsOf(invite.businessName)}</span>
              )}
            </span>
            <p className="text-title">{invite.businessName}</p>
            <p className="text-body-sm text-muted-foreground">
              As {invite.staffName} on their team.
            </p>
            <AcceptMyInvite inviteId={invite.inviteId} businessName={invite.businessName} />
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2">
        <Button asChild variant="ghost" className="h-11 w-full px-5 text-label">
          <Link href="/onboarding/basics">Set up my own business instead</Link>
        </Button>
        <form action="/auth/sign-out" method="post">
          <Button type="submit" variant="ghost" className="h-11 w-full px-5 text-label">
            Not you? Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}

function InvitesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading invites" className="flex flex-col items-center gap-4">
      <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="h-5 w-full animate-pulse rounded bg-muted" />
      <div className="h-44 w-full animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

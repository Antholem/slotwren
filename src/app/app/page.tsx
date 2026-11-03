import type { Metadata } from "next";
import { Suspense } from "react";

import { SignedInTopBar } from "@/components/shared/top-bar";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Dashboard",
};

// Placeholder until the dashboard shell and Today view land (Phase 3). The proxy
// only lets members of a business reach /app.
export default function DashboardPage() {
  return (
    <>
      <SignedInTopBar />
      <main className="flex flex-1 justify-center bg-background px-4 py-12">
        <div className="w-full max-w-2xl rounded-xl border bg-card p-6 shadow-sm sm:p-10">
          <h1 className="text-heading">Dashboard</h1>
          <Suspense fallback={<div className="mt-2 h-5 w-64 animate-pulse rounded bg-muted" />}>
            <SignedInAs />
          </Suspense>
        </div>
      </main>
    </>
  );
}

async function SignedInAs() {
  const user = await requireUser();
  return (
    <p className="mt-2 text-body text-muted-foreground">
      Signed in as <span className="font-medium text-foreground">{user.email}</span>.
    </p>
  );
}

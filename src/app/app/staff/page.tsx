import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageBody } from "@/components/dashboard/page-header";
import { getDashboardContext } from "@/server/auth/dashboard";
import { listServices } from "@/server/db/queries/services";
import { listStaff } from "@/server/db/queries/staff";

import { StaffView } from "./staff-view";

export const metadata: Metadata = { title: "Staff" };

export default function StaffPage() {
  return (
    <Suspense fallback={<StaffSkeleton />}>
      <Staff />
    </Suspense>
  );
}

async function Staff() {
  await connection(); // "upcoming time off" depends on the current time
  const { claims, business, role } = await getDashboardContext();
  const [staff, services] = await Promise.all([
    listStaff(claims, business.id, new Date()),
    listServices(claims, business.id),
  ]);

  return (
    <StaffView
      staff={staff}
      services={services.filter((s) => !s.archivedAt).map((s) => ({ id: s.id, name: s.name }))}
      canEdit={role === "owner"}
    />
  );
}

function StaffSkeleton() {
  return (
    <PageBody label="Loading staff">
      <div aria-busy="true" className="flex flex-col gap-8">
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-2">
            <div className="h-9 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="h-5 w-80 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-11 w-36 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
      </div>
    </PageBody>
  );
}

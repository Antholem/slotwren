import type { Metadata } from "next";
import { Suspense } from "react";

import { PageBody } from "@/components/dashboard/page-header";
import { currencySymbol } from "@/lib/money";
import { getDashboardContext } from "@/server/auth/dashboard";
import { listServices, listStaffOptions } from "@/server/db/queries/services";

import { ServicesView } from "./services-view";

export const metadata: Metadata = { title: "Services" };

export default function ServicesPage() {
  return (
    <Suspense fallback={<ServicesSkeleton />}>
      <Services />
    </Suspense>
  );
}

async function Services() {
  const { claims, business, role } = await getDashboardContext();
  const [services, staff] = await Promise.all([
    listServices(claims, business.id),
    listStaffOptions(claims, business.id),
  ]);

  return (
    <ServicesView
      services={services}
      staff={staff}
      canEdit={role === "owner"}
      currency={business.currency}
      currencySymbol={currencySymbol(business.currency)}
      slotIntervalMin={business.slotIntervalMin}
    />
  );
}

function ServicesSkeleton() {
  return (
    <PageBody label="Loading services">
      <div aria-busy="true" className="flex flex-col gap-8">
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-2">
            <div className="h-9 w-40 animate-pulse rounded-lg bg-muted" />
            <div className="h-5 w-72 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-11 w-36 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex flex-col divide-y rounded-xl border bg-card">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-6 px-6 py-5">
              <div className="flex flex-1 flex-col gap-2">
                <div className="h-5 w-48 animate-pulse rounded bg-muted" />
                <div className="h-4 w-64 animate-pulse rounded bg-muted" />
              </div>
              <div className="hidden h-5 w-16 animate-pulse rounded bg-muted md:block" />
              <div className="hidden h-5 w-12 animate-pulse rounded bg-muted md:block" />
            </div>
          ))}
        </div>
      </div>
    </PageBody>
  );
}

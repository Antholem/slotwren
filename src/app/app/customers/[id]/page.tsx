import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageBody } from "@/components/dashboard/page-header";
import { todayIn } from "@/lib/time-off";
import { getDashboardContext } from "@/server/auth/dashboard";
import { getBookingOptions } from "@/server/db/queries/calendar";
import { getCustomerProfile } from "@/server/db/queries/customers";

import { CustomerProfileView } from "./profile-view";

export const metadata: Metadata = { title: "Customer" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A customer (docs/design/owner-dashboard/4-customer-profile). */
export default function CustomerPage({ params }: PageProps<"/app/customers/[id]">) {
  return (
    <PageBody label="Customer">
      <Suspense fallback={<ProfileSkeleton />}>
        <Customer params={params} />
      </Suspense>
    </PageBody>
  );
}

async function Customer({ params }: Pick<PageProps<"/app/customers/[id]">, "params">) {
  const { id } = await params;
  const { claims, business, role } = await getDashboardContext();
  const now = new Date();
  const [profile, options] = await Promise.all([
    UUID.test(id) ? getCustomerProfile(claims, business.id, id, now) : null,
    getBookingOptions(claims, business.id),
  ]);

  if (!profile) {
    return (
      <div className="flex flex-col items-start gap-4">
        <Breadcrumb name="Not found" />
        <div className="w-full rounded-xl border border-dashed bg-card p-10 text-center">
          <h1 className="text-title">We couldn&rsquo;t find that customer</h1>
          <p className="mt-2 text-body text-muted-foreground">
            They may belong to another business, or the link is wrong.
          </p>
          <Link
            href={"/app/customers" as Route}
            className="mt-4 inline-flex min-h-11 items-center text-label text-primary underline underline-offset-4"
          >
            Back to customers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Breadcrumb name={profile.name} />
      <CustomerProfileView
        profile={profile}
        zone={business.timezone}
        currency={business.currency}
        role={role}
        options={options}
        today={todayIn(business.timezone, now)}
      />
    </>
  );
}

function Breadcrumb({ name }: { name: string }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-2 text-body">
        <li>
          <Link
            href={"/app/customers" as Route}
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4 focus-visible:rounded focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Customers
          </Link>
        </li>
        <li aria-hidden className="text-muted-foreground">
          /
        </li>
        <li aria-current="page">{name}</li>
      </ol>
    </nav>
  );
}

function ProfileSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading customer" className="flex flex-col gap-6">
      <div className="h-5 w-48 animate-pulse rounded bg-muted" />
      <div className="h-32 animate-pulse rounded-xl border bg-card" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="h-80 animate-pulse rounded-xl border bg-card" />
        <div className="h-64 animate-pulse rounded-xl border bg-card" />
      </div>
    </div>
  );
}

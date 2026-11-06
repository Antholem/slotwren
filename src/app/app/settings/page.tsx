import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageBody } from "@/components/dashboard/page-header";
import { SettingsHeader } from "@/components/settings/settings-header";
import { bookingHost } from "@/lib/booking-link";
import { CURRENCIES, currencyLabel } from "@/lib/money";
import { listTimeZones, timeZoneLabel } from "@/lib/timezones";
import { getDashboardContext } from "@/server/auth/dashboard";
import { countUpcoming, getBusinessSettings, listStaffRanges } from "@/server/db/queries/settings";

import { BusinessForm } from "./business-form";
import { BusinessSummary } from "./business-summary";

export const metadata: Metadata = { title: "Business settings" };

const DESCRIPTION = "Your business details, opening hours and booking rules.";

export default function BusinessSettingsPage() {
  return (
    <PageBody>
      <SettingsHeader current="business" description={DESCRIPTION} />
      <Suspense fallback={<FormSkeleton />}>
        <BusinessSettings />
      </Suspense>
    </PageBody>
  );
}

async function BusinessSettings() {
  await connection(); // counts "upcoming" bookings and time off
  const { claims, business, role } = await getDashboardContext();
  const settings = await getBusinessSettings(claims, business.id);
  // The business was just deleted or left: the dashboard error state offers a retry.
  if (!settings) throw new Error("Business settings not found");

  if (role !== "owner") return <BusinessSummary settings={settings} host={bookingHost()} />;

  const now = new Date();
  const [staffRanges, upcoming] = await Promise.all([
    listStaffRanges(claims, business.id),
    countUpcoming(claims, business.id, now),
  ]);
  return (
    <BusinessForm
      settings={settings}
      staffRanges={staffRanges}
      upcoming={upcoming}
      now={now.toISOString()}
      host={bookingHost()}
      // Labelled once on the server: Node and browsers format offsets differently.
      timeZones={listTimeZones().map((zone) => ({ value: zone, label: timeZoneLabel(zone) }))}
      currencies={CURRENCIES.map((code) => ({ value: code, label: currencyLabel(code) }))}
    />
  );
}

function FormSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading business settings" className="flex flex-col gap-6">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-6 rounded-xl border bg-card p-5 sm:p-8">
          <div className="flex flex-col gap-2">
            <div className="h-6 w-40 animate-pulse rounded bg-muted" />
            <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted" />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="h-11 animate-pulse rounded-lg bg-muted" />
            <div className="h-11 animate-pulse rounded-lg bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

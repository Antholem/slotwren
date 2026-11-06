import { PanelsTopLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageBody } from "@/components/dashboard/page-header";
import { ComingSoonPanel, SettingsHeader } from "@/components/settings/settings-header";

export const metadata: Metadata = { title: "Booking page settings" };

export default function BookingPageSettingsPage() {
  return (
    <PageBody>
      <SettingsHeader current="booking-page" description="What customers see when they book." />
      <ComingSoonPanel icon={<PanelsTopLeft />} title="Booking page options">
        <p>
          Add an introduction, your address and contact details, and your policies to the booking
          page.
        </p>
        <p>
          For now it shows your business name, logo and colour from the{" "}
          <Link href="/app/settings" className="text-foreground underline underline-offset-4">
            Business tab
          </Link>
          .
        </p>
      </ComingSoonPanel>
    </PageBody>
  );
}

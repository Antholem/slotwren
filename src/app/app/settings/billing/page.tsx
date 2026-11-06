import type { Metadata } from "next";

import { PageBody } from "@/components/dashboard/page-header";
import { SettingsHeader } from "@/components/settings/settings-header";

export const metadata: Metadata = { title: "Billing" };

// Placeholder until Stripe Billing is built (plan, usage and invoices).
export default function BillingSettingsPage() {
  return (
    <PageBody>
      <SettingsHeader
        current="billing"
        description="Your plan, usage and invoices will appear here once billing is set up."
      />
    </PageBody>
  );
}

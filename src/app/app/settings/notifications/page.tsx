import { Bell } from "lucide-react";
import type { Metadata } from "next";

import { PageBody } from "@/components/dashboard/page-header";
import { ComingSoonPanel, SettingsHeader } from "@/components/settings/settings-header";

export const metadata: Metadata = { title: "Notification settings" };

export default function NotificationSettingsPage() {
  return (
    <PageBody>
      <SettingsHeader
        current="notifications"
        description="Emails and reminders for you and your customers."
      />
      <ComingSoonPanel icon={<Bell />} title="Notifications">
        <p>
          Choose which emails you get when someone books, reschedules or cancels, and when customers
          get their reminders.
        </p>
        <p>These arrive with booking confirmations and reminders.</p>
      </ComingSoonPanel>
    </PageBody>
  );
}

import type { Metadata } from "next";

import { PageBody } from "@/components/dashboard/page-header";
import { SettingsHeader } from "@/components/settings/settings-header";

export const metadata: Metadata = {
  title: "Embed on your website",
};

// Placeholder so "Add to your website" lands somewhere real. The embed snippet
// and its options are built with the widget.
export default function EmbedSettingsPage() {
  return (
    <PageBody>
      <SettingsHeader
        current="embed"
        description="The embed code and its options (button text, position, chat) are on the way. Until then, link to your booking page from your site."
      />
    </PageBody>
  );
}

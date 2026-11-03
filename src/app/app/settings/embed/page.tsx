import type { Metadata } from "next";

import { SignedInTopBar } from "@/components/shared/top-bar";

export const metadata: Metadata = {
  title: "Embed on your website",
};

// Placeholder so the "Add to your website" link from onboarding lands
// somewhere real. The embed snippet and its options are built with the widget.
export default function EmbedSettingsPage() {
  return (
    <>
      <SignedInTopBar />
      <main className="flex flex-1 justify-center bg-background px-4 py-12">
        <div className="w-full max-w-2xl rounded-xl border bg-card p-6 shadow-sm sm:p-10">
          <h1 className="text-heading">Add booking to your website</h1>
          <p className="mt-2 text-body text-muted-foreground">
            The embed code and its options (button text, position, chat) are on the way. Until then,
            link to your booking page from your site.
          </p>
        </div>
      </main>
    </>
  );
}

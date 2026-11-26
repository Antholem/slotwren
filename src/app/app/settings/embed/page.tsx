import type { Metadata } from "next";
import { Suspense } from "react";

import { PageBody } from "@/components/dashboard/page-header";
import { SettingsHeader } from "@/components/settings/settings-header";
import { env } from "@/env";
import { embedSettings } from "@/lib/embed";
import { getDashboardContext } from "@/server/auth/dashboard";
import { getEmbedOptions } from "@/server/db/queries/settings";

import { EmbedView } from "./embed-view";

export const metadata: Metadata = { title: "Embed on your website" };

/**
 * Settings → Embed (docs/design/setup-settings/5-embed-on-your-website): the
 * website widget's options, the snippet to paste, a live preview, which
 * websites may show it, and install steps. Owners change it; staff can copy
 * the code.
 */
export default function EmbedSettingsPage() {
  return (
    <PageBody>
      <SettingsHeader current="embed" description="Put booking on your own website." />
      <Suspense fallback={<EmbedSkeleton />}>
        <Embed />
      </Suspense>
    </PageBody>
  );
}

async function Embed() {
  const { claims, business, role } = await getDashboardContext();
  const options = await getEmbedOptions(claims, business.id);
  const settings = embedSettings(options?.embed as Parameters<typeof embedSettings>[0]);
  return (
    <EmbedView
      appUrl={env.NEXT_PUBLIC_APP_URL}
      slug={business.slug}
      businessName={business.name}
      brandColor={options?.brandColor ?? business.brandColor}
      chatAvailable={Boolean(options?.aiEnabled && options.plan === "pro")}
      canEdit={role === "owner"}
      initial={settings}
    />
  );
}

function EmbedSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <div className="flex flex-col gap-6">
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
      </div>
      <div className="h-[32rem] animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

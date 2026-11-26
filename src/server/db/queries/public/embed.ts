import "server-only";

import { eq } from "drizzle-orm";

import { type EmbedSettings, embedSettings } from "@/lib/embed";

import { adminQuery, type TenantScoped } from "../../admin";
import { businesses } from "../../schema";

/*
 * The website widget's options for one business (settings.embed), read
 * without a signed-in user: by the widget's config endpoint and by the proxy
 * deciding which websites may frame the booking page. Only the embed options
 * and the brand colour; nothing else from settings.
 */
export const getEmbedSettings = adminQuery(
  async (
    db,
    { businessId }: TenantScoped,
  ): Promise<{ embed: EmbedSettings; brandColor: string } | null> => {
    const [row] = await db
      .select({ settings: businesses.settings, brandColor: businesses.brandColor })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    if (!row) return null;
    return { embed: embedSettings(row.settings?.embed), brandColor: row.brandColor };
  },
);

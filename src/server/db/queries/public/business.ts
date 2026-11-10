import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { cache } from "react";

import { tenantLookup } from "../../admin";
import { businesses } from "../../schema";

/** What anyone may see about a business on its booking page. */
export type PublicBusiness = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string;
};

/**
 * A live business by its booking-link slug, for /b/[slug]. Explicit public
 * columns only (never settings, plan, Stripe IDs or contact details). Cached
 * per request so the page and its metadata share one lookup.
 */
const lookupBySlug = tenantLookup(
  "bySlug",
  async (db, { slug }: { slug: string }): Promise<PublicBusiness | null> => {
    const [row] = await db
      .select({
        id: businesses.id,
        slug: businesses.slug,
        name: businesses.name,
        logoUrl: businesses.logoUrl,
        brandColor: businesses.brandColor,
      })
      .from(businesses)
      .where(and(eq(businesses.slug, slug), isNotNull(businesses.onboardedAt)))
      .limit(1);
    return row ?? null;
  },
);

// Keyed by the slug string: React's cache compares arguments by identity.
export const getPublicBusinessBySlug = cache((slug: string) => lookupBySlug({ slug }));

import { CalendarClock } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Logo } from "@/components/shared/logo";
import { initialsOf, readableTextOn } from "@/lib/color";
import { SLUG_PATTERN } from "@/lib/slug";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";

/*
 * Placeholder for the public booking page (Phase 2 builds the booking flow).
 * The link owners share already works: it shows the business, in its logo and
 * colour, and says online booking opens soon, instead of a 404.
 */

const lookup = (slug: string) => (SLUG_PATTERN.test(slug) ? getPublicBusinessBySlug(slug) : null);

export async function generateMetadata({ params }: PageProps<"/b/[slug]">): Promise<Metadata> {
  const business = await lookup((await params).slug);
  return {
    title: { absolute: business ? `${business.name} — online booking opens soon` : "Not found" },
    // Nothing to book yet: keep it out of search results until Phase 2.
    robots: { index: false, follow: false },
  };
}

export default function BookingPage({ params }: PageProps<"/b/[slug]">) {
  return (
    <Suspense fallback={<BookingSkeleton />}>
      <Booking params={params} />
    </Suspense>
  );
}

async function Booking({ params }: Pick<PageProps<"/b/[slug]">, "params">) {
  const business = await lookup((await params).slug);
  if (!business) notFound();

  return (
    <main className="flex flex-1 flex-col items-center bg-background">
      <div aria-hidden className="h-2 w-full" style={{ backgroundColor: business.brandColor }} />
      <div className="flex w-full max-w-md flex-1 flex-col items-center gap-6 px-4 py-16 text-center">
        <span
          className="flex size-20 items-center justify-center overflow-hidden rounded-2xl text-heading"
          style={
            business.logoUrl
              ? undefined
              : { backgroundColor: business.brandColor, color: readableTextOn(business.brandColor) }
          }
        >
          {business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user upload on Supabase Storage
            <img
              src={business.logoUrl}
              alt={`${business.name} logo`}
              className="size-full object-contain"
            />
          ) : (
            <span aria-hidden>{initialsOf(business.name)}</span>
          )}
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-heading sm:text-display">{business.name}</h1>
          <p className="inline-flex items-center justify-center gap-2 text-title">
            <CalendarClock aria-hidden className="size-5 text-muted-foreground" />
            Online booking opens soon
          </p>
        </div>
        <p className="text-body text-muted-foreground">
          You&rsquo;ll be able to choose a service and a time right here. Until then, get in touch
          with {business.name} directly to book.
        </p>
        <footer className="mt-auto flex items-center gap-2 pt-12 text-body-sm text-muted-foreground">
          Booking by <Logo className="scale-90" />
        </footer>
      </div>
    </main>
  );
}

function BookingSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading booking page"
      className="flex flex-1 flex-col items-center gap-6 px-4 py-16"
    >
      <div className="size-20 animate-pulse rounded-2xl bg-muted" />
      <div className="h-10 w-64 animate-pulse rounded bg-muted" />
      <div className="h-6 w-48 animate-pulse rounded bg-muted" />
    </main>
  );
}

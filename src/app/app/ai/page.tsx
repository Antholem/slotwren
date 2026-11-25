import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageBody } from "@/components/dashboard/page-header";
import { env } from "@/env";
import { sanitizeReply } from "@/lib/ai-guardrails";
import { parseTranscriptFilters, TRANSCRIPTS_PAGE_SIZE } from "@/lib/ai-transcripts";
import { todayIn } from "@/lib/time-off";
import { getDashboardContext } from "@/server/auth/dashboard";
import { FAQ_LIMITS } from "@/server/catalog/ai";
import { buildTranscriptItems } from "@/server/ai/transcript-view";
import {
  bookingsByCode,
  getAiUsage,
  getTranscript,
  listFaqs,
  listTranscripts,
} from "@/server/db/queries/ai";

import { AiView, type OpenTranscript } from "./ai-view";

export const metadata: Metadata = { title: "AI receptionist" };

/**
 * The AI receptionist (docs/design/owner-dashboard/6-ai-receptionist): the
 * on/off switch and this month's usage, transcripts with filters, search and
 * pagination in the URL (like Bookings), the open transcript (?c=), and the
 * FAQ the assistant answers from. Owners change things; staff read.
 */
export default function AiPage({ searchParams }: PageProps<"/app/ai">) {
  return (
    <Suspense fallback={<AiSkeleton />}>
      <Ai searchParams={searchParams} />
    </Suspense>
  );
}

async function Ai({ searchParams }: Pick<PageProps<"/app/ai">, "searchParams">) {
  const params = await searchParams;
  const { claims, business, role } = await getDashboardContext();
  await connection(); // "today" and "this month" are per request
  const filters = parseTranscriptFilters(params);
  const zone = business.timezone;
  const today = todayIn(zone, new Date());

  const [page, usage, faqRows, transcript] = await Promise.all([
    listTranscripts(claims, business.id, filters, {
      zone,
      today,
      limit: TRANSCRIPTS_PAGE_SIZE,
      offset: (filters.page - 1) * TRANSCRIPTS_PAGE_SIZE,
    }),
    getAiUsage(claims, business.id, { zone, today }),
    listFaqs(claims, business.id),
    filters.c ? getTranscript(claims, business.id, filters.c) : null,
  ]);

  let open: OpenTranscript | null = null;
  if (transcript) {
    // Confirmations name bookings by code; link the ones still here.
    const codes = transcript.messages.flatMap((m) =>
      [...JSON.stringify(m.parts).matchAll(/"code":"(SW-[A-Z0-9]{4}-\d{2})"/g)].map((x) => x[1]!),
    );
    const linked = await bookingsByCode(claims, business.id, [...new Set(codes)]);
    open = {
      id: transcript.id,
      startedAt: transcript.startedAt.toISOString(),
      lastMessageAt: transcript.lastMessageAt.toISOString(),
      channel: transcript.channel,
      outcome: transcript.outcome,
      customerId: transcript.customerId,
      customerName: transcript.customerName,
      items: buildTranscriptItems(transcript.messages, {
        bookingIdByCode: Object.fromEntries(linked.map((b) => [b.code, b.id])),
        clean: (text) =>
          sanitizeReply(text, { origin: env.NEXT_PUBLIC_APP_URL, slug: business.slug }),
      }),
      questions: transcript.questions.map((q) => ({
        ...q,
        createdAt: q.createdAt.toISOString(),
        repliedAt: q.repliedAt?.toISOString() ?? null,
      })),
    };
  }

  return (
    <AiView
      filters={filters}
      rows={page.rows.map((r) => ({
        ...r,
        startedAt: r.startedAt.toISOString(),
        lastMessageAt: r.lastMessageAt.toISOString(),
      }))}
      total={page.total}
      today={today}
      zone={zone}
      role={role}
      slug={business.slug}
      usage={usage}
      faqs={faqRows}
      faqLimits={FAQ_LIMITS}
      open={open}
      missing={filters.c !== null && transcript === null}
    />
  );
}

function AiSkeleton() {
  return (
    <PageBody label="Loading the AI receptionist">
      <div aria-busy="true" className="flex flex-col gap-6">
        <div className="h-36 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-6 xl:grid-cols-[22rem_1fr_22rem]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-3 rounded-xl border bg-card p-5">
              {Array.from({ length: 6 }, (_, j) => (
                <div key={j} className="h-14 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </PageBody>
  );
}

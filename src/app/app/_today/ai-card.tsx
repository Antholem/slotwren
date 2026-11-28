import { Sparkle } from "lucide-react";

import { formatInZone } from "@/lib/dates";
import type { TodayAi } from "@/server/db/queries/today";

/** "AI receptionist today": owners only. */
export function AiCard({ ai, zone }: { ai: TodayAi; zone: string }) {
  const question = ai.latestQuestion;
  return (
    <section
      aria-labelledby="ai-today"
      className="flex flex-col gap-5 rounded-xl border bg-card p-6"
    >
      <h2 id="ai-today" className="flex items-center gap-2 text-title">
        <Sparkle aria-hidden className="size-5 text-primary" />
        AI receptionist today
      </h2>
      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-body-sm text-muted-foreground">Conversations</dt>
          <dd className="font-mono text-heading tabular-nums">{ai.conversations}</dd>
        </div>
        <div>
          <dt className="text-body-sm text-muted-foreground">Bookings made</dt>
          <dd className="font-mono text-heading tabular-nums">{ai.bookings}</dd>
        </div>
      </dl>
      {question ? (
        <div className="flex flex-col gap-3 rounded-xl bg-warning-soft p-5 text-warning-text">
          <p className="flex items-center gap-2 text-label">
            <span aria-hidden className="size-2 rounded-full bg-warning" />
            {ai.openQuestions === 1 ? "1 question" : `${ai.openQuestions} questions`} for the team
          </p>
          <p className="text-body text-foreground">
            &ldquo;{question.message}&rdquo; · {question.name},{" "}
            <span className="font-mono tabular-nums">
              {formatInZone(question.createdAt, zone, "HH:mm")}
            </span>
          </p>
          {/* Foreground, not muted: muted text is under AA on the warning tint. */}
          <p className="text-body-sm text-foreground">
            {question.email} · From the AI chat · email not verified
          </p>
          <a
            href={`mailto:${question.email}`}
            className="inline-flex min-h-11 w-fit items-center text-label underline underline-offset-4 focus-visible:rounded focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Reply by email
          </a>
        </div>
      ) : (
        <p className="text-body-sm text-muted-foreground">No questions waiting for the team.</p>
      )}
    </section>
  );
}

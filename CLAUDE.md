@AGENTS.md

# Slotwren

Multi-tenant booking SaaS for small service businesses (salons, clinics, tutors, consultants): branded booking page, embeddable widget, reminders, owner dashboard and an AI receptionist that books through tool calls, always after the customer confirms. Portfolio-grade: it must look and behave like a product a client would pay for.

- Product brief and roadmap: `docs/brief.md`
- Mockups, one folder per page: `docs/design/`. Match them.
- Approved data model and RLS strategy: `docs/proposal-foundation.md`
- Decision records: `docs/adr/`

## Stack

Don't substitute any of these without asking.

| Layer        | Choice                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Framework    | Next.js 16 App Router (`cacheComponents` on), React 19, TypeScript strict, pnpm 12                         |
| UI           | Tailwind CSS v4, shadcn/ui (Radix base, Nova preset), lucide-react                                         |
| Data         | Supabase Postgres, Auth (magic link + Google), Realtime, Storage                                           |
| ORM          | Drizzle ORM + drizzle-kit; custom SQL migrations for RLS and constraints                                   |
| Forms        | Zod 4 + React Hook Form                                                                                    |
| Dates        | date-fns + @date-fns/tz. Store `timestamptz` (UTC); each business has an IANA timezone                     |
| Jobs / email | Inngest; Resend + React Email                                                                              |
| Billing      | Stripe Billing (test mode)                                                                                 |
| AI           | Vercel AI SDK; `AI_PROVIDER` (gemini \| anthropic) + `AI_MODEL` pick the model. Claude: `claude-haiku-5-5` |
| Ops          | Upstash rate limiting, Sentry                                                                              |
| Tests / CI   | Vitest, Playwright + axe, GitHub Actions, Vercel                                                           |

## Commands

```bash
pnpm dev                 # Next dev server (needs .env.local; see .env.example)
pnpm db:start            # local Supabase (Docker); applies migrations on first start
pnpm db:reset            # recreate local DB from supabase/migrations
pnpm db:seed             # Lumen Studio demo data (idempotent: replaces the demo business)

pnpm check               # lint + typecheck + format:check + unit/component tests
pnpm lint | typecheck | format | test
pnpm test:integration    # against local Supabase (pnpm db:start first)
pnpm test:e2e            # Playwright, desktop + mobile, with axe

pnpm db:generate --name <what>    # migration from schema.ts changes
pnpm db:migration --name <what>   # empty custom SQL migration (RLS, constraints, triggers)
pnpm db:migrate                   # apply pending migrations locally
```

Fresh `.env.local` from the running stack:

```bash
pnpm exec supabase status -o env --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
  --override-name auth.publishable_key=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  --override-name auth.secret_key=SUPABASE_SECRET_KEY --override-name db.url=DATABASE_URL
```

## Folder map

```text
src/
  proxy.ts               auth session refresh; protects /app, /onboarding (Next 16: not middleware.ts)
  env.ts                 Zod-validated env. Import `env` / `clientEnv`, never process.env
  app/
    (marketing)/         landing
    (auth)/              sign-in, auth/callback, onboarding
    app/                 owner dashboard (protected): today, calendar, bookings, customers,
                         services, staff, ai, insights, settings/*
    b/[slug]/            public booking flow (+ opengraph-image)
    m/[token]/           manage booking (reschedule / cancel)
    embed/[slug]/        iframe target for the widget
    api/chat/[slug]/     AI receptionist (streaming)
    api/webhooks/stripe/ billing webhooks
    api/inngest/         background jobs
  components/
    ui/                  shadcn primitives (generated; edit sparingly)
    booking/ dashboard/ chat/ settings/ marketing/ shared/
  emails/                React Email templates
  hooks/                 client hooks (Realtime, media queries)
  lib/                   client-safe pure helpers: result.ts, money, dates, utils
  server/                server-only (`import "server-only"`)
    db/schema.ts         Drizzle schema
    db/client.ts         adminDb and withRls()
    db/queries/          tenant-scoped data access, one file per aggregate
    booking/slots.ts     PURE slot engine
    booking/service.ts   the ONE booking write path
    ai/                  model.ts, prompt.ts, tools.ts
    auth/ billing/ email/ jobs/ supabase/ rate-limit.ts
embed/embed.ts           widget source, bundled by tsup to public/embed.js
scripts/seed.ts          Lumen Studio seed
supabase/                config.toml, migrations/ (drizzle output + custom SQL)
tests/                   unit/, components/, integration/, e2e/, support/
```

## Architecture rules

These are hard rules. If a task seems to need breaking one, stop and ask.

1. **Multi-tenant.** Every tenant table has `business_id`. Isolation is enforced twice:
   Postgres RLS **and** an explicit `business_id` filter in every query in
   `src/server/db/queries`. Never query tenant data from client components (ESLint
   blocks `@/server` imports from `components/`, `hooks/` and `lib/`).
2. **Two ways into the database** (`src/server/db/client.ts`):
   - `withRls(claims, fn)`: anything done as a signed-in user (dashboard). Runs as the
     `authenticated` role with the user's JWT claims, so RLS applies.
   - `adminDb`: bypasses RLS. Only for paths with no signed-in user: public booking
     page, manage links, AI chat, webhooks, jobs, seed. **Every adminDb query function
     takes `businessId` as a required parameter**. The only exceptions are the lookups
     that resolve a tenant (by slug, manage-token hash, Stripe customer ID).
   - **Public queries select explicit public columns** and return `Public…` types. Never
     customer emails or phones, private notes, token hashes, Stripe IDs or internal
     settings. `tests/integration/public-data.test.ts` enforces this; add it with the
     first public query.
3. **One booking write path.** All booking creates, reschedules, cancels and status
   changes go through `src/server/booking/service.ts`. The public page, embed, dashboard
   and AI tools all call it.
4. **Double booking is impossible in the database.** The `no_double_booking` exclusion
   constraint covers `(staff_id, tstzrange(buffered_start, buffered_end, '[)'))` for
   pending/confirmed bookings. Don't pre-check and trust it; map SQLSTATE `23P01` to
   "That time was just taken".
5. **The slot engine is pure.** `src/server/booking/slots.ts` has no DB access, no
   `Date.now()` (take `now` as input), no env. It is computed in the business timezone,
   DST-safe, and unit-tested exhaustively.
6. **Server actions** validate input with Zod and return `Result<T>` from
   `src/lib/result.ts`: `{ ok: true, data } | { ok: false, error: { code, message } }`.
   Expected failures are values, not throws. `message` must be safe to show users.
7. **The AI never writes.** AI tools read or _propose_. A booking is created or changed
   only when the customer taps Confirm in the UI, which calls `booking/service.ts`.
8. **Accessibility: WCAG 2.2 AA.** Every interactive element is keyboard-reachable with
   visible focus, inputs have labels, text contrast is 4.5:1, and touch targets are at
   least 44 px on the booking flow.

## Conventions

- **Theme.** `src/app/globals.css` is a copy of `docs/design/globals.css` (the source of
  truth) plus one `shadcn/tailwind.css` import. Use the tokens (`bg-primary`,
  `text-success-text`, `bg-staff-violet-soft`, `text-mono`, `text-heading`…); don't invent
  colours or use raw palette classes like `bg-teal-600`. Times, prices and booking codes
  use `font-mono tabular-nums`.
- **Staff colours** cycle teal → violet → pink (`staffColorFor(index)`). Always show the
  staff name next to the colour.
- **Time.** Persist instants as UTC `timestamptz`. Convert at the edges with
  `@date-fns/tz` (`TZDate`). Working hours are local wall-clock `time` in the business
  timezone. Show customers their own timezone and note the business's.
- **Money.** Integer cents plus the business's `currency`. `0` displays as "Free".
- **Tokens** (manage links, invites): random, returned once, stored SHA-256 hashed.
- **Commits.** Small, conventional (`feat(booking): …`, `fix(db): …`, `test: …`,
  `chore: …`, `docs: …`).

## Gotchas

- Next.js 16.4 differs from older versions. Read `node_modules/next/dist/docs/` before
  using an API you're unsure of (see AGENTS.md).
- `LayoutProps` / `PageProps` are generated globals: `pnpm typecheck` runs `next typegen`
  first.
- `shadcn` CLI: `components.json` must point at `src/app/globals.css`. It once rewrote
  `docs/design/globals.css`; never let it touch `docs/`.
- Next skips `.env.local` when `NODE_ENV=test`, so `vitest.config.mts` reads it directly.
- Code under `src/server` imports `server-only`; scripts run with tsx can't import it, so
  `scripts/` builds its own Drizzle connection.
- Drizzle connects as `postgres`, which **bypasses RLS**. RLS only applies inside
  `withRls`.
- Env keys for unbuilt features are optional locally and on previews, and required when
  `VERCEL_ENV=production`.

## Definition of done

A task is done only when all of these hold:

- [ ] `pnpm check` passes (lint, types, formatting, unit/component tests)
- [ ] `pnpm test:integration` passes if anything under `src/server` or `supabase/` changed
- [ ] New logic has tests: slot/timing rules exhaustively, service functions against
      the local DB, and a Playwright path for any new user flow
- [ ] Every new page or async component has **loading, empty and error states**
- [ ] A11y checked: keyboard-only walkthrough, visible focus, and axe clean in Playwright
- [ ] **No console errors or warnings** in the browser or server log for the flow
- [ ] Matches the mockup in `docs/design/` in light and dark, at mobile and desktop widths
- [ ] No secrets in code; new env vars added to `src/env.ts` and `.env.example`
- [ ] Committed in small conventional commits; summary says what changed and what's next

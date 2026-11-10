@AGENTS.md

# Slotwren

Multi-tenant booking SaaS for small service businesses (salons, clinics, tutors, consultants): branded booking page, embeddable widget, reminders, owner dashboard and an AI receptionist that books through tool calls, always after the customer confirms. Portfolio-grade: it must look and behave like a product a client would pay for.

- Product brief and roadmap: `docs/brief.md`
- Mockups, one folder per page: `docs/design/`. Match them.
- Approved data model and RLS strategy: `docs/proposal-foundation.md`
- Decision records: `docs/adr/`
- Auth setup (Google sign-in, local email viewer): `docs/auth-setup.md`

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
pnpm db:start            # local Supabase (Docker), minus logflare/vector/edge-runtime/imgproxy/supavisor
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
                         services, staff, ai, insights, settings/*, live (booking link + QR).
                         layout.tsx is the shell; server actions per page call src/server/catalog
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
  lib/                   client-safe pure helpers: result.ts, money, dates, hours, time-off, theme, utils
  server/                server-only (`import "server-only"`)
    db/schema.ts         Drizzle schema
    db/client.ts         withRls() (and the raw adminDb, used only by db/admin.ts)
    db/admin.ts          adminQuery() / tenantLookup(): the only doors to adminDb
    db/queries/          dashboard data access via withRls, one file per aggregate
    db/queries/public/   adminQuery-based reads for booking page, embed, manage, AI
    db/queries/system/   adminQuery-based access for webhooks and jobs
    booking/slots.ts     PURE slot engine
    booking/service.ts   the ONE booking write path
    ai/                  model.ts, prompt.ts, tools.ts
    catalog/             services etc.: auth + validation + Result, behind server actions
    email/send.ts        sendEmail(): Resend, or logs the email when RESEND_API_KEY is unset
    auth/ billing/ jobs/ supabase/ rate-limit.ts
                         auth/dashboard.ts: getDashboardContext() (user, business, role)
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
   blocks `@/server` imports from `components/`, `hooks/` and `lib/`). A new table
   needs RLS enabled and policies in a custom migration:
   `tests/integration/rls-coverage.test.ts` fails otherwise, and `rls.test.ts` picks up
   any table with `business_id` and fails until `fillTenant()` creates a row in it.
2. **Two ways into the database** (`src/server/db/client.ts`):
   - `withRls(claims, fn)`: anything done as a signed-in user (dashboard). Runs as the
     `authenticated` role with the user's JWT claims, so RLS applies.
   - `adminDb`: bypasses RLS. Only for paths with no signed-in user: public booking
     page, manage links, AI chat, webhooks, jobs, seed. **Every adminDb query function
     takes `businessId` as a required parameter**. The only exceptions are the lookups
     that resolve a tenant (by slug, manage-token hash, Stripe customer ID).
     Enforced: never import `adminDb` directly. Define queries with `adminQuery` (requires
     `businessId` by type) or `tenantLookup` from `src/server/db/admin.ts`, and only in
     `src/server/db/queries/public/` or `queries/system/`. ESLint blocks everything else.
   - Who may do what under RLS (owner vs staff) is in `docs/adr/0002-rls-strategy.md`.
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
  timezone. Show customers their own timezone and note the business's. Print business
  dates with `formatInZone()` (`src/lib/dates.ts`), never `Intl`/`toLocale…String` without
  a timezone: the server and the browser would disagree (and hydration mismatch).
- **Money input.** `parsePriceToCents(text, currency)` reads "35,50" and "1.234,56";
  ambiguous "1,234" follows the currency and is refused rather than guessed.
- **Theme.** Light, dark or system, applied before first paint by `THEME_SCRIPT`
  (`src/lib/theme.ts`); the account menu switches it. Check new pages in dark (e2e
  `dark-mode.spec.ts` runs axe over them).
- **Hours and time off.** Weekly hours: `src/lib/hours.ts` (`weekSchemaFor` on the slot
  grid) edited with `components/shared/week-editor.tsx` (onboarding and the staff sheet).
  Time off: `src/lib/time-off.ts` converts business-local dates to instants; all-day runs
  midnight to midnight, so DST days are 23 or 25 h. The business's opening hours live in
  `businesses.settings.openingHours` (written by onboarding): display and a soft warning
  only; bookable times come from each staff member's `availability_rules`.
- **Changing timezone or slot grid** (Settings → Business, `server/catalog/settings.ts`):
  hours keep their clock times, upcoming time off moves to the same local dates and times,
  bookings never move. A coarser grid refuses off-grid staff hours unless the owner asks to
  round them inward (`roundRangeInward`).
- **Money.** Integer cents plus the business's `currency`. `0` displays as "Free".
- **Tokens** (manage links, invites): random, returned once, stored SHA-256 hashed.
- **Commits.** Small, conventional (`feat(booking): …`, `fix(db): …`, `test: …`,
  `chore: …`, `docs: …`).

## Gotchas

- Start local Supabase with `pnpm db:start`, not bare `supabase start`. The full stack
  fails its health checks on the dev machine (Docker has ~6 GB RAM), so the script skips
  analytics (logflare, vector), edge functions, image transforms and the pooler. Nothing
  in the app uses them locally. Mailpit, Studio, Auth, Storage and Realtime still run.

- Next.js 16.4 differs from older versions. Read `node_modules/next/dist/docs/` before
  using an API you're unsure of (see AGENTS.md).
- `LayoutProps` / `PageProps` are generated globals: `pnpm typecheck` runs `next typegen`
  first.
- `shadcn` CLI: `components.json` must point at `src/app/globals.css`. It once rewrote
  `docs/design/globals.css`; never let it touch `docs/`. Generated files import `cn` from
  `"cn"`; switch them to `@/lib/utils` (it knows the type scale). Answer "no" when it asks
  to overwrite `button.tsx` (it has our AA hover colour).
- `cn()` doesn't treat variant-prefixed classes as conflicts: to resize a `SheetContent`,
  use `data-[side=right]:sm:max-w-lg`, not `sm:max-w-lg`.
- `text-muted-foreground` on `bg-muted` is 4.39:1, which fails AA. Put muted text on
  `bg-card`/`bg-background` (4.6:1+), or use a bordered badge instead of a muted fill.
- Next skips `.env.local` when `NODE_ENV=test`, so `vitest.config.mts` reads it directly.
- Code under `src/server` imports `server-only`; scripts run with tsx can't import it, so
  `scripts/` builds its own Drizzle connection.
- Drizzle connects as `postgres`, which **bypasses RLS**. RLS only applies inside
  `withRls`.
- `pnpm test:e2e` reuses a running `pnpm dev`, which compiles routes and server actions on
  first use and can stall under parallel tests. For a reliable local run (what CI does):
  `pnpm build`, `pnpm start --port 3100`, then `PLAYWRIGHT_BASE_URL=http://localhost:3100
pnpm test:e2e --workers=1` (CI also uses one worker; the dev machine stalls Auth and
  overlays under two). Magic links are followed by path, so any port works.
- Creating a business via `withRls`: generate the id with `crypto.randomUUID()` and insert
  **without** `.returning()`. A trigger makes the creator the owner, but Postgres checks
  RETURNING against the select policy before that trigger runs (error 42501).
- Under `withRls`, an UPDATE or DELETE that RLS filters out affects 0 rows without an
  error; check the row count. Blocked INSERTs and missing column grants raise 42501.
- Env keys for unbuilt features (AI, Resend, Stripe, Inngest, Upstash) are optional
  everywhere, including Vercel Production, until `REQUIRE_FEATURE_KEYS=true`. That's set
  on Vercel Production at launch (Phase 5). When you add a feature key to `src/env.ts`,
  use `featureKey()` and mark it `(launch)` in `.env.example`.

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

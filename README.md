# Slotwren

Booking, reminders and an AI receptionist for small service businesses: salons, clinics,
tutors and consultants. Each business gets a branded booking page and an embeddable widget,
and the owner a dashboard. An AI receptionist answers questions and books, always after the
customer confirms.

> **Status: Phase 1 of 5 (Foundation) is done.** Owners can sign up, set up a business,
> manage services, staff, hours, time off and settings. Customer booking arrives in
> Phase 2: until then a booking link shows a branded "online booking opens soon" page.

## Roadmap

- [x] **Phase 1, Foundation:**
  - Sign-in (magic link, Google) and an onboarding wizard.
  - Services, staff and invites, weekly hours and time off, business settings.
  - Row level security on every table, with tests proving one business can't touch another's data.
- [ ] **Phase 2, Booking engine:** the slot engine (DST-safe, exhaustively tested), the
      public booking flow, manage links, confirmation and reminder emails.
- [ ] **Phase 3, Dashboard:** Today, calendar, bookings, customers, insights, live updates.
- [ ] **Phase 4, AI receptionist and embed:** chat that answers from the business's data
      and proposes bookings; a one-line website widget.
- [ ] **Phase 5, Billing and launch:** Stripe plans, landing page, demo mode, monitoring.

## Stack

| Layer      | Choice                                                                         |
| ---------- | ------------------------------------------------------------------------------ |
| App        | Next.js 16 (App Router, Cache Components), React 19, TypeScript (strict), pnpm |
| UI         | Tailwind CSS v4, shadcn/ui, lucide-react; WCAG 2.2 AA, light and dark          |
| Data       | Supabase (Postgres, Auth, Storage), Drizzle ORM, SQL migrations                |
| Validation | Zod 4 with React Hook Form; every server action re-validates                   |
| Time       | date-fns with `@date-fns/tz`: UTC in the database, business timezone at edges  |
| Email      | Resend and React Email                                                         |
| Tests / CI | Vitest, Playwright with axe, GitHub Actions                                    |

## Architecture in brief

- **Multi-tenant, isolated twice.** Every tenant row has a `business_id`. Postgres row level
  security and an explicit `business_id` filter in every dashboard query each stop a
  cross-tenant read on their own. Composite `(id, business_id)` foreign keys stop
  cross-tenant links. Public pages use a separate, fenced query layer that returns public
  fields only.
- **One booking write path.** The booking page, the embed, the dashboard and the AI all go
  through one booking service, and a Postgres exclusion constraint makes double booking
  impossible even under a race.
- **Time is stored once, shown locally.** Instants are UTC `timestamptz`; working hours are
  wall-clock times in the business timezone; conversions happen at the edges and are tested
  across DST changes.

Decisions are recorded in [`docs/adr/`](docs/adr/):

- [0001 data model](docs/adr/0001-data-model.md)
- [0002 row level security](docs/adr/0002-rls-strategy.md)

The approved schema proposal is in [`docs/proposal-foundation.md`](docs/proposal-foundation.md).
Contributor rules and the folder map are in [`CLAUDE.md`](CLAUDE.md).

## Run it locally

Needs Node 22+, pnpm (via Corepack) and Docker.

```bash
pnpm install
pnpm db:start                # local Supabase in Docker; applies the migrations
pnpm exec supabase status -o env --override-name api.url=NEXT_PUBLIC_SUPABASE_URL --override-name auth.publishable_key=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY --override-name auth.secret_key=SUPABASE_SECRET_KEY --override-name db.url=DATABASE_URL > .env.local
pnpm db:seed                 # Lumen Studio, a demo salon with staff, hours and bookings
pnpm dev                     # http://localhost:3000
```

Sign in at <http://localhost:3000/sign-in> as `demo-owner@lumen-studio.example.com`. The
magic link arrives in the local mail viewer, Mailpit, at <http://127.0.0.1:54324>. Any
other address signs up and starts the onboarding wizard. Google sign-in is optional; see
[`docs/auth-setup.md`](docs/auth-setup.md).

## Tests

```bash
pnpm check              # lint, types, formatting, unit tests
pnpm test:integration   # against local Supabase: RLS, permissions, constraints
pnpm test:e2e           # Playwright on desktop and mobile, with axe accessibility checks
```

For a reliable end-to-end run, test a production build with one worker, as CI does:
`pnpm build`, then `pnpm start --port 3100`, then
`PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm test:e2e --workers=1`.

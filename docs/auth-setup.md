# Auth setup

Slotwren signs owners in with a Supabase **magic link** (always on) or **Google** (optional).
The sign-in page asks Supabase Auth which providers are enabled
(`GET /auth/v1/settings`) and shows the Google button only when Google is configured, so
there is no app env var to keep in sync.

How the pieces fit:

| Piece                     | Where                                                                |
| ------------------------- | -------------------------------------------------------------------- |
| Sign-in page and actions  | `src/app/(auth)/sign-in/`, `src/app/(auth)/actions.ts`               |
| Callback (both flows)     | `src/app/(auth)/auth/callback/route.ts`                              |
| Sign-out (POST)           | `src/app/(auth)/auth/sign-out/route.ts`                              |
| Route protection          | `src/proxy.ts`: no session → `/sign-in`, no business → `/onboarding` |
| Magic-link email template | `supabase/templates/magic-link.html`                                 |

## Local development

Magic-link emails never leave your machine. They land in the local Supabase stack's mail
viewer, **Mailpit**, at <http://127.0.0.1:54324> (`pnpm db:status` prints it as
`MAILPIT_URL`). Sign in at <http://localhost:3000/sign-in>, then open the email there and
click **Sign in to Slotwren**.

After changing `supabase/config.toml` or `supabase/templates/`, restart the stack:
`pnpm db:stop && pnpm db:start`.

## Enabling Google sign-in

You need one Google OAuth client. Its redirect URIs point at **Supabase**, not at the app:
Google → Supabase → our `/auth/callback`.

### 1. Google Cloud Console

1. Create (or pick) a project at <https://console.cloud.google.com>, e.g. "Slotwren".
2. **Google Auth Platform → Branding**: app name `Slotwren`, your support email and
   developer contact email. Under **Authorized domains** add `supabase.co` and your
   production domain (e.g. `slotwren.com`).
3. **Audience**: User type **External**. While the app is in **Testing**, only the test
   users you list can sign in, so add your own Google account. Click **Publish app** when
   you go live. The scopes below are non-sensitive, so publishing doesn't need Google
   verification.
4. **Data access → Add or remove scopes**: `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile`.
5. **Clients → Create client → Web application**, named e.g. "Slotwren web":
   - **Authorized JavaScript origins**: `http://localhost:3000` and
     `https://<your production domain>`
   - **Authorized redirect URIs**:
     - `http://127.0.0.1:54321/auth/v1/callback` (local Supabase)
     - `https://<project-ref>.supabase.co/auth/v1/callback` (hosted Supabase; copy the
       exact value from the Supabase Google provider page)
6. Copy the **Client ID** and **Client secret**.

### 2a. Local Supabase

1. Create `supabase/.env` (git-ignored by the root `.env*` rule):

   ```dotenv
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<client secret>
   ```

2. In `supabase/config.toml`, set `enabled = true` under `[auth.external.google]`.
   Don't commit that line: a stack without the two variables can't start Google.
3. `pnpm db:stop && pnpm db:start`. The Google button appears on `/sign-in` within a minute,
   because the provider check is cached.

### 2b. Hosted Supabase (production)

In the Supabase dashboard for the project:

1. **Authentication → Sign In / Providers → Google**: enable it, paste the Client ID and
   Client secret, and save.
2. **Authentication → URL Configuration**:
   - **Site URL**: `https://<your production domain>`
   - **Redirect URLs**: `https://<your production domain>/auth/callback`,
     `http://localhost:3000/auth/callback`, and for Vercel previews
     `https://*-<your-vercel-team>.vercel.app/auth/callback`
3. On Vercel, set `NEXT_PUBLIC_APP_URL` for Production to the same production URL.
   Previews default to their own deployment URL.

## Hosted email setup (before launch)

- **Templates**: in **Authentication → Emails**, set both **Magic link** and **Confirm
  signup** to the subject `Your Slotwren sign-in link` and paste the body of
  `supabase/templates/magic-link.html`. Its link goes straight to `/auth/callback` with a
  token hash, so it also works when the email is opened on another device. The default
  templates still work, but only in the browser that asked for the link.
- **SMTP**: Supabase's built-in sender is heavily rate-limited and only for testing. Point
  **Authentication → Emails → SMTP settings** at Resend before launch (Phase 5).

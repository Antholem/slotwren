import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { env } from "@/env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers,
 * bound to the request's auth cookies. Auth only: tenant data goes through
 * Drizzle (`withRls` / `adminDb`), never through this client.
 */
export async function createSupabaseServerClient() {
  // The auth client reads Date.now() as it starts; mark this as request-time
  // work so Cache Components doesn't flag it during prerendering.
  await connection();
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can't set cookies. The proxy refreshes the
            // session on every protected request, so this is safe to ignore.
          }
        },
      },
    },
  );
}

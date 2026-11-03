import "server-only";

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import type { RlsClaims } from "@/server/db/client";

/**
 * Refresh the Supabase session for this request and return the verified user
 * claims (or null). Any refreshed auth cookies are written to `response`;
 * redirect with `redirectWithSession` so they aren't lost.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Cache-Control headers that stop a CDN caching a response with auth cookies.
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );

  // getClaims() verifies the JWT (and refreshes it if expired). Never trust
  // getSession() on the server: it reads the cookie without verifying it.
  const { data } = await supabase.auth.getClaims();
  const claims: RlsClaims | null = data?.claims
    ? { sub: data.claims.sub, email: data.claims.email }
    : null;

  return { response, claims };
}

/** A redirect that keeps any auth cookies `updateSession` refreshed. */
export function redirectWithSession(request: NextRequest, response: NextResponse, path: string) {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = response.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

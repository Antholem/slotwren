import "server-only";

import { redirect } from "next/navigation";

import type { RlsClaims } from "@/server/db/client";
import { createSupabaseServerClient } from "@/server/supabase/server";

export type CurrentUser = { id: string; email: string | null };

/** The verified signed-in user, or null. Reads cookies: call inside <Suspense>. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  return { id: data.claims.sub, email: data.claims.email ?? null };
}

/** The signed-in user, or a redirect to /sign-in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** The claims `withRls` needs for this user. */
export function rlsClaimsFor(user: CurrentUser): RlsClaims {
  return { sub: user.id, email: user.email ?? undefined };
}

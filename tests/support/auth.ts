import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { RlsClaims } from "@/server/db/client";

/** Test-only password, so tests can sign in as their users. Local stack only. */
const PASSWORD = "local-test-password-2026";

/** Creates and deletes real auth users on the local stack (service key). */
export function testUsers() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { persistSession: false },
    },
  );
  const created: string[] = [];

  return {
    async create(label: string): Promise<RlsClaims & { email: string }> {
      const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: PASSWORD,
      });
      if (error) throw error;
      created.push(data.user.id);
      return { sub: data.user.id, email };
    },
    /** A browser-like client signed in as this user (Realtime, Storage), with RLS applying. */
    async signIn(user: { email: string }): Promise<SupabaseClient> {
      const client = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false } },
      );
      const { error } = await client.auth.signInWithPassword({
        email: user.email,
        password: PASSWORD,
      });
      if (error) throw error;
      return client;
    },
    async cleanup() {
      for (const id of created) await admin.auth.admin.deleteUser(id);
    },
  };
}

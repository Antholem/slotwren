import { createClient } from "@supabase/supabase-js";

import type { RlsClaims } from "@/server/db/client";

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
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (error) throw error;
      created.push(data.user.id);
      return { sub: data.user.id, email };
    },
    async cleanup() {
      for (const id of created) await admin.auth.admin.deleteUser(id);
    },
  };
}

import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/env";

/**
 * Supabase client for the browser: auth, Storage uploads and (later) Realtime,
 * all as the signed-in user so RLS applies. Never for tenant table queries:
 * those go through server code.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

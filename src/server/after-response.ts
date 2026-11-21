import "server-only";

import { after } from "next/server";

/*
 * Work that follows a committed change (emails, Inngest events) runs after
 * the response has gone, so nobody waits on Resend or Inngest to see their
 * booking (on Vercel, `after` keeps the function alive until it finishes).
 *
 * Outside a request (integration tests, scripts) there is no response to
 * wait for: the work runs now and its result is returned. Inside one, the
 * caller gets `whenDeferred`, its best statement of what will happen.
 */
export async function afterResponse<T>(work: () => Promise<T>, whenDeferred: T): Promise<T> {
  const logged = () =>
    work().catch((error: unknown) => {
      console.error("[after] follow-up work failed", error);
      return whenDeferred;
    });
  try {
    after(logged);
  } catch {
    // "`after` was called outside a request scope"
    return logged();
  }
  return whenDeferred;
}

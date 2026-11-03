/**
 * Reads emails from the local Supabase stack's Mailpit (the mail viewer at
 * http://127.0.0.1:54324). Auth emails sent by `supabase start` land there.
 */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type MailpitSearch = { messages: { ID: string }[] };
type MailpitMessage = { HTML: string; Subject: string };

/** Poll until an email to `to` arrives, then return its sign-in link. */
export async function waitForSignInLink(to: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const query = encodeURIComponent(`to:"${to}"`);

  while (Date.now() < deadline) {
    const search = (await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`).then((r) =>
      r.json(),
    )) as MailpitSearch;
    const latest = search.messages[0];
    if (latest) {
      const message = (await fetch(`${MAILPIT_URL}/api/v1/message/${latest.ID}`).then((r) =>
        r.json(),
      )) as MailpitMessage;
      const href = message.HTML.match(/href="([^"]*\/auth\/callback[^"]*)"/)?.[1];
      if (!href) throw new Error(`No sign-in link in "${message.Subject}"`);
      return href.replaceAll("&amp;", "&");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No email to ${to} within ${timeoutMs} ms. Is Mailpit running (pnpm db:start)?`);
}

/*
 * The chat's conversation id lives in this tab only (sessionStorage), so a
 * refresh carries on the same chat and a new tab starts fresh. The server
 * holds the transcript; the id is all the browser keeps.
 */

const key = (slug: string) => `slotwren:chat:${slug}`;

export function readConversationId(slug: string): string | null {
  try {
    return sessionStorage.getItem(key(slug));
  } catch {
    return null;
  }
}

export function rememberConversationId(slug: string, id: string) {
  try {
    sessionStorage.setItem(key(slug), id);
  } catch {
    // Private mode or storage off: the chat still works until a refresh.
  }
}

export function forgetConversationId(slug: string) {
  try {
    sessionStorage.removeItem(key(slug));
  } catch {
    // Nothing to forget.
  }
}

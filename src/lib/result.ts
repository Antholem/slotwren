/**
 * Return type for server actions and service functions: expected failures are
 * values, not exceptions. `code` is stable for the UI to branch on; `message`
 * is safe to show to the user.
 */
export type Result<T, E extends string = string> =
  | { ok: true; data: T }
  | { ok: false; error: { code: E; message: string; fieldErrors?: Record<string, string[]> } };

export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data });

export const err = <E extends string>(
  code: E,
  message: string,
  fieldErrors?: Record<string, string[]>,
): Result<never, E> => ({ ok: false, error: { code, message, fieldErrors } });

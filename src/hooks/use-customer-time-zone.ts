"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => null;

/**
 * The customer's IANA timezone, from their browser. Null while rendering on
 * the server and during hydration, so customer-local times never mismatch:
 * render a placeholder until it's known.
 */
export function useCustomerTimeZone(): string | null {
  return useSyncExternalStore(subscribe, browserZone, serverZone);
}

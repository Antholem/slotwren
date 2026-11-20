"use client";

import type { Route } from "next";
import Link from "next/link";
import { useSyncExternalStore } from "react";

/*
 * The manage link on the confirmation page. The token is returned once when
 * the booking is made and lives only in this tab (sessionStorage) and in the
 * confirmation email; the server never sees it again after storing its hash.
 */

const key = (bookingId: string) => `slotwren:manage:${bookingId}`;

export function rememberManageToken(bookingId: string, token: string) {
  try {
    sessionStorage.setItem(key(bookingId), token);
  } catch {
    // Private mode or storage off: the email still has the link.
  }
}

function read(bookingId: string): string | null {
  try {
    return sessionStorage.getItem(key(bookingId));
  } catch {
    return null;
  }
}

const subscribe = () => () => {};

export function ManageLink({ bookingId }: { bookingId: string }) {
  const token = useSyncExternalStore(
    subscribe,
    () => read(bookingId),
    () => null,
  );
  return token ? (
    <Link
      href={`/m/${token}` as Route}
      className="mx-auto inline-flex min-h-11 items-center text-title underline underline-offset-4 hover:no-underline"
    >
      Manage booking
    </Link>
  ) : (
    <p className="text-center text-body text-muted-foreground">
      To reschedule or cancel, use the Manage booking link in your confirmation email.
    </p>
  );
}

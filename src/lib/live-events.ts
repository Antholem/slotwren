/*
 * In-page signal that a booking changed (src/components/dashboard/live-bookings.tsx
 * hears it from Supabase Realtime). The page itself refreshes from the server;
 * parts that load their own data, like the booking drawer, listen here so a
 * live change (a customer cancelling) shows at once. Client-safe and pure.
 */

const BOOKING_CHANGED = "slotwren:booking-changed";

export function announceBookingChanged(bookingId: string) {
  window.dispatchEvent(new CustomEvent(BOOKING_CHANGED, { detail: { bookingId } }));
}

/** Calls `onChange` when `bookingId` changes elsewhere. Returns the unsubscribe. */
export function onBookingChanged(bookingId: string, onChange: () => void): () => void {
  const listener = (event: Event) => {
    if ((event as CustomEvent<{ bookingId: string }>).detail?.bookingId === bookingId) onChange();
  };
  window.addEventListener(BOOKING_CHANGED, listener);
  return () => window.removeEventListener(BOOKING_CHANGED, listener);
}

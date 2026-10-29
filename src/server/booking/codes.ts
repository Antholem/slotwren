/**
 * Human-friendly booking codes, e.g. "SW-8K3D-27". Shown on confirmations and
 * used (with the customer's email) by the AI to look a booking up. Unique per
 * business (bookings_business_code). Pure, so it's safe to use from scripts.
 */

// No 0/O, 1/I/L or U, so codes survive being read out loud or typed from paper.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export const BOOKING_CODE_PATTERN = /^SW-[2-9A-HJKMNP-TV-Z]{4}-\d{2}$/;

function cryptoRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}

/** `random` is injectable so seeds and tests are reproducible. */
export function generateBookingCode(random: () => number = cryptoRandom): string {
  let letters = "";
  for (let i = 0; i < 4; i++) letters += ALPHABET[Math.floor(random() * ALPHABET.length)];
  const digits = String(Math.floor(random() * 100)).padStart(2, "0");
  return `SW-${letters}-${digits}`;
}

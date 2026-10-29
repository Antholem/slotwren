import { createHash, randomBytes } from "node:crypto";

/**
 * Manage-link and invite tokens: 256 bits of randomness, shown to the user once
 * (in the link) and stored only as a SHA-256 hash. A database leak can't be
 * turned into working links.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

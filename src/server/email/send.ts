import "server-only";

import type { ReactElement } from "react";
import { Resend } from "resend";

import { env } from "@/env";

export type SendResult =
  { delivered: true } | { delivered: false; reason: "not_configured" | "failed" };

let client: Resend | null = null;

/**
 * Send a transactional email with Resend. Without RESEND_API_KEY (local dev,
 * previews before launch) it skips sending instead of failing, so flows keep
 * working; callers show a copyable link either way. Never throws.
 *
 * `logLines` (the links inside: invite and manage links are bearer tokens)
 * are logged in development only. Anywhere else they would land in hosted
 * logs, so the owner's copy-once dialog is the only place they appear.
 */
export async function sendEmail({
  to,
  subject,
  react,
  logLines,
}: {
  to: string;
  subject: string;
  react: ReactElement;
  /** Logged in development when email isn't configured, e.g. the link inside. */
  logLines: string[];
}): Promise<SendResult> {
  if (!env.RESEND_API_KEY) {
    const details = env.NODE_ENV === "development" ? [`To: ${to}`, ...logLines] : [];
    console.info(
      [`[email] RESEND_API_KEY not set; not sending "${subject}".`, ...details].join("\n  "),
    );
    return { delivered: false, reason: "not_configured" };
  }

  client ??= new Resend(env.RESEND_API_KEY);
  try {
    const { error } = await client.emails.send({ from: env.EMAIL_FROM, to, subject, react });
    if (error) {
      console.error("[email] Resend rejected the email", { subject, name: error.name });
      return { delivered: false, reason: "failed" };
    }
    return { delivered: true };
  } catch (error) {
    console.error("[email] Sending failed", { subject, error });
    return { delivered: false, reason: "failed" };
  }
}

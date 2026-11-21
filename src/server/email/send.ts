import "server-only";

import type { ReactElement } from "react";
import { Resend } from "resend";

import { env } from "@/env";

export type SendResult =
  { delivered: true } | { delivered: false; reason: "not_configured" | "failed" };

export type EmailAttachment = { filename: string; content: string; contentType: string };

let client: Resend | null = null;

/**
 * "Lumen Studio <bookings@slotwren.com>": EMAIL_FROM's address under the
 * business's name, stripped of anything that could break the header.
 */
export function fromAddress(name?: string): string {
  if (!name) return env.EMAIL_FROM;
  const address = /<([^>]+)>/.exec(env.EMAIL_FROM)?.[1] ?? env.EMAIL_FROM;
  const safe = name
    .replace(/["<>\r\n\\]/g, "")
    .trim()
    .slice(0, 60);
  return safe ? `"${safe}" <${address}>` : env.EMAIL_FROM;
}

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
  fromName,
  replyTo,
  attachments,
}: {
  to: string | string[];
  subject: string;
  react: ReactElement;
  /** Logged in development when email isn't configured, e.g. the link inside. */
  logLines: string[];
  /** Shown as the sender: the business's name. */
  fromName?: string;
  /** Where replies go: the business, not Slotwren. */
  replyTo?: string | string[] | null;
  attachments?: EmailAttachment[];
}): Promise<SendResult> {
  if (!env.RESEND_API_KEY) {
    const details =
      env.NODE_ENV === "development"
        ? [
            `To: ${[to].flat().join(", ")}`,
            ...logLines,
            ...(attachments ?? []).map((a) => `Attachment: ${a.filename}`),
          ]
        : [];
    console.info(
      [`[email] RESEND_API_KEY not set; not sending "${subject}".`, ...details].join("\n  "),
    );
    return { delivered: false, reason: "not_configured" };
  }

  client ??= new Resend(env.RESEND_API_KEY);
  try {
    const { error } = await client.emails.send({
      from: fromAddress(fromName),
      to,
      subject,
      react,
      ...(replyTo?.length ? { replyTo } : {}),
      ...(attachments?.length
        ? {
            attachments: attachments.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.content, "utf8"),
              contentType: a.contentType,
            })),
          }
        : {}),
    });
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

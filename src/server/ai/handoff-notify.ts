import "server-only";

import { AiHandoffQuestionEmail } from "@/emails/ai-handoff-question";
import { env } from "@/env";
import { formatInZone } from "@/lib/dates";
import { afterResponse } from "@/server/after-response";
import { getEmailBusiness, getOwnerEmails } from "@/server/db/queries/system/owners";
import { sendEmail } from "@/server/email/send";
import { limitAll } from "@/server/rate-limit";

import { describe } from "./guardrails";

/*
 * "Message the team" reached the business: email its owners, after the
 * response (the customer never waits on Resend), and never more than a few
 * an hour per business (`handoff:owner-email`). Past that the question still
 * waits on the dashboard (Today, /app/ai and the customer's profile); only
 * the email is skipped. Nothing here can fail the hand-off.
 */

export type HandoffNotice = {
  businessId: string;
  conversationId: string;
  name: string;
  email: string;
  message: string;
  at: Date;
};

export type HandoffEmailResult = "sent" | "limited" | "no_owners" | "failed";

/** Send now: the owners' email, unless the business has had its few this hour. */
export async function emailOwnersAboutHandoff(notice: HandoffNotice): Promise<HandoffEmailResult> {
  const { businessId } = notice;
  try {
    const limited = await limitAll([["handoff:owner-email", businessId]]);
    if (!limited.ok) return "limited";
    const [to, business] = await Promise.all([
      getOwnerEmails({ businessId }),
      getEmailBusiness({ businessId }),
    ]);
    if (to.length === 0 || !business) return "no_owners";
    const dashboardUrl = new URL(
      `/app/ai?c=${notice.conversationId}`,
      env.NEXT_PUBLIC_APP_URL,
    ).toString();
    await sendEmail({
      to,
      subject: `Question for the team from ${notice.name}`,
      replyTo: notice.email,
      react: AiHandoffQuestionEmail({
        business: {
          name: business.name,
          brandColor: business.brandColor,
          address: business.address,
          logoUrl: business.logoUrl,
        },
        name: notice.name,
        email: notice.email,
        question: notice.message,
        sentAt: formatInZone(notice.at, business.timezone, "EEE d MMM, HH:mm"),
        dashboardUrl,
      }),
      // Never the question or the customer's details in the log.
      logLines: [`Hand-off question for the owners of ${business.name}: ${dashboardUrl}`],
    });
    return "sent";
  } catch (error) {
    console.error("[ai-handoff] Owner email failed", { businessId, ...describe(error) });
    return "failed";
  }
}

/** After the response (or now, outside a request): see emailOwnersAboutHandoff. */
export function notifyOwnersOfHandoff(notice: HandoffNotice): Promise<HandoffEmailResult | null> {
  return afterResponse(() => emailOwnersAboutHandoff(notice), null);
}

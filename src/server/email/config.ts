import "server-only";

import { env } from "@/env";

/** Whether emails really go out (without RESEND_API_KEY, sendEmail only logs them). */
export const emailConfigured = () => Boolean(env.RESEND_API_KEY);

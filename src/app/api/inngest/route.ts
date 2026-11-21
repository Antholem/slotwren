import { serve } from "inngest/next";

import { inngest } from "@/server/jobs/client";
import { functions } from "@/server/jobs/functions";

/*
 * Inngest calls this to register and run our functions (reminders). Requests
 * are signed with INNGEST_SIGNING_KEY in production; the local dev server
 * (INNGEST_DEV=1, `pnpm jobs:dev`) needs no keys.
 */
export const { GET, POST, PUT } = serve({ client: inngest, functions });

"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { env } from "@/env";
import { CURRENT_BUSINESS_COOKIE, getDashboardContext } from "@/server/auth/dashboard";

/** Business switcher: remember the choice if the user belongs to that business. */
export async function switchBusiness(businessId: unknown) {
  const id = z.uuid().parse(businessId);
  const { businesses } = await getDashboardContext();
  if (!businesses.some((b) => b.id === id)) return;

  (await cookies()).set(CURRENT_BUSINESS_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  refresh();
}

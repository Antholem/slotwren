"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { getDashboardContext, setCurrentBusiness } from "@/server/auth/dashboard";

/** Business switcher: remember the choice if the user belongs to that business. */
export async function switchBusiness(businessId: unknown) {
  const id = z.uuid().parse(businessId);
  const { businesses } = await getDashboardContext();
  if (!businesses.some((b) => b.id === id)) return;
  await setCurrentBusiness(id);
  refresh();
}

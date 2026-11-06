"use server";

import { refresh } from "next/cache";

import { getDashboardContext } from "@/server/auth/dashboard";
import type { Actor } from "@/server/catalog/services";
import { checkSettingsSlug, saveBusinessSettings } from "@/server/catalog/settings";

/*
 * Settings → Business actions: resolve who is acting from the session (never
 * from the client) and delegate to src/server/catalog/settings.ts.
 */

async function actor(): Promise<Actor> {
  const { claims, business, role } = await getDashboardContext();
  return { claims, businessId: business.id, role };
}

export async function saveBusinessSettingsAction(input: unknown) {
  const result = await saveBusinessSettings(await actor(), input);
  // The shell shows the name, logo and booking link too.
  if (result.ok) refresh();
  return result;
}

export async function checkSettingsSlugAction(slug: string) {
  return checkSettingsSlug(await actor(), slug);
}

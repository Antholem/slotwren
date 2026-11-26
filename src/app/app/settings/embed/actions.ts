"use server";

import { refresh } from "next/cache";

import { getDashboardContext } from "@/server/auth/dashboard";
import { saveEmbedSettings } from "@/server/catalog/embed";

/** Settings → Embed: save the widget options (owners; who's acting comes from the session). */
export async function saveEmbedSettingsAction(input: unknown) {
  const { claims, business, role } = await getDashboardContext();
  const result = await saveEmbedSettings({ claims, businessId: business.id, role }, input);
  if (result.ok) refresh();
  return result;
}

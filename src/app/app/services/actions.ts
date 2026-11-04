"use server";

import { refresh } from "next/cache";

import type { Result } from "@/lib/result";
import { type Actor, removeService, restoreService, saveService } from "@/server/catalog/services";
import { getDashboardContext } from "@/server/auth/dashboard";

/*
 * Services page actions: resolve who is acting from the session (never from
 * the client), delegate to src/server/catalog/services.ts, and refresh the
 * page on success so the optimistic list settles on the saved data.
 */

async function actor(): Promise<Actor> {
  const { claims, business, role } = await getDashboardContext();
  return { claims, businessId: business.id, role };
}

function settle<T extends Result<unknown, string>>(result: T): T {
  if (result.ok) refresh();
  return result;
}

export async function saveServiceAction(input: unknown, serviceId?: string) {
  return settle(await saveService(await actor(), input, serviceId));
}

export async function removeServiceAction(serviceId: string) {
  return settle(await removeService(await actor(), serviceId));
}

export async function restoreServiceAction(serviceId: string) {
  return settle(await restoreService(await actor(), serviceId));
}

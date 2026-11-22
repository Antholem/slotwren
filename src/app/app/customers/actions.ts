"use server";

import { refresh } from "next/cache";

import { getDashboardContext } from "@/server/auth/dashboard";
import { saveCustomerNotes } from "@/server/catalog/customers";

/** Customer profile: save the private notes (owners only; the database agrees). */
export async function saveNotesAction(customerId: string, input: unknown) {
  const { claims, business, role } = await getDashboardContext();
  const result = await saveCustomerNotes(
    { claims, businessId: business.id, role },
    customerId,
    input,
  );
  if (result.ok) refresh();
  return result;
}

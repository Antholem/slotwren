import "server-only";

import { z } from "zod";

import { err, ok, type Result } from "@/lib/result";
import { serviceFormSchemaFor } from "@/lib/validation/services";
import type { RlsClaims } from "@/server/db/client";
import { pgError } from "@/server/db/errors";
import {
  createService,
  removeService as removeServiceRow,
  restoreService as restoreServiceRow,
  staffBelongToBusiness,
  updateService,
} from "@/server/db/queries/services";

/*
 * What the Services page's server actions do, minus reading the session:
 * authorise (owners only), validate, write, and turn expected failures into
 * Result values with messages safe to show. Tested directly in
 * tests/integration/services.test.ts.
 */

export type Actor = { claims: RlsClaims; businessId: string; role: "owner" | "staff" };

/** Saving a service also needs the business's currency, to read the typed price. */
export type ServiceActor = Actor & { currency: string };

type SaveError = "forbidden" | "invalid_input" | "invalid_staff" | "not_found";

const FORBIDDEN = "Only owners can change services. Ask an owner to make this change.";
const NOT_FOUND = "That service no longer exists. Refresh to see the latest list.";
const idSchema = z.uuid();

export async function saveService(
  actor: ServiceActor,
  input: unknown,
  serviceId?: string,
): Promise<Result<{ id: string }, SaveError>> {
  if (actor.role !== "owner") return err("forbidden", FORBIDDEN);
  if (serviceId !== undefined && !idSchema.safeParse(serviceId).success) {
    return err("not_found", NOT_FOUND);
  }

  const parsed = serviceFormSchemaFor(actor.currency).safeParse(input);
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    const first = Object.values(fieldErrors).flat()[0] as string | undefined;
    return err("invalid_input", first ?? "Check the highlighted fields.", fieldErrors);
  }
  const values = parsed.data;

  if (!(await staffBelongToBusiness(actor.claims, actor.businessId, values.staffIds))) {
    return err("invalid_staff", "Pick staff from your team.", {
      staffIds: ["Pick staff from your team."],
    });
  }

  try {
    if (serviceId) {
      const found = await updateService(actor.claims, actor.businessId, serviceId, values);
      return found ? ok({ id: serviceId }) : err("not_found", NOT_FOUND);
    }
    return ok({ id: await createService(actor.claims, actor.businessId, values) });
  } catch (error) {
    // A staff member removed between the check and the write.
    if (pgError(error).code === "23503") {
      return err("invalid_staff", "Pick staff from your team.", {
        staffIds: ["Pick staff from your team."],
      });
    }
    throw error;
  }
}

/** Delete, or archive when the service has bookings. */
export async function removeService(
  actor: Actor,
  serviceId: string,
): Promise<Result<{ outcome: "deleted" | "archived" }, "forbidden" | "not_found">> {
  if (actor.role !== "owner") return err("forbidden", FORBIDDEN);
  if (!idSchema.safeParse(serviceId).success) return err("not_found", NOT_FOUND);
  const outcome = await removeServiceRow(actor.claims, actor.businessId, serviceId);
  return outcome === "not_found" ? err("not_found", NOT_FOUND) : ok({ outcome });
}

export async function restoreService(
  actor: Actor,
  serviceId: string,
): Promise<Result<{ id: string }, "forbidden" | "not_found">> {
  if (actor.role !== "owner") return err("forbidden", FORBIDDEN);
  if (!idSchema.safeParse(serviceId).success) return err("not_found", NOT_FOUND);
  const restored = await restoreServiceRow(actor.claims, actor.businessId, serviceId);
  return restored ? ok({ id: serviceId }) : err("not_found", NOT_FOUND);
}

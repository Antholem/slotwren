import { describe, expectTypeOf, it } from "vitest";

import type { adminQuery, TenantScoped, tenantLookup } from "@/server/db/admin";

// Type-level guarantees, checked by `pnpm typecheck` (the @ts-expect-error
// lines fail the build if the restriction ever goes away). Nothing runs a query.
type AdminQuery = typeof adminQuery;
type TenantLookup = typeof tenantLookup;

export function adminQueryTypeChecks(define: AdminQuery, lookup: TenantLookup) {
  // OK: businessId is part of the arguments.
  const query = define(async (_db, _args: TenantScoped & { serviceId: string }) => null);
  void query({ businessId: "b", serviceId: "s" });

  // @ts-expect-error callers can't leave businessId out
  void query({ serviceId: "s" });

  // @ts-expect-error an admin query without businessId doesn't compile
  define(async (_db, _args: { slug: string }) => null);

  // Tenant-resolving lookups are the named exceptions...
  lookup("bySlug", async (_db, _args: { slug: string }) => null);
  // @ts-expect-error ...and only those
  lookup("byEmail", async (_db, _args: { email: string }) => null);
}

describe("adminQuery", () => {
  it("returns a function that requires the businessId it was defined with", () => {
    type Query = ReturnType<typeof adminQuery<TenantScoped & { serviceId: string }, null>>;
    expectTypeOf<Parameters<Query>[0]>().toEqualTypeOf<TenantScoped & { serviceId: string }>();
  });
});

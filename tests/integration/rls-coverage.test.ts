import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterAll, describe, expect, it } from "vitest";

import * as schema from "@/server/db/schema";

import { connectTestDb, listTenantTables } from "../support/db";

/*
 * Guard: a table can't reach the database without row level security.
 * Reads the live catalog after migrations, so it catches a new table whose
 * custom SQL migration forgot `enable row level security` or its policies.
 * Fix a failure by adding RLS + policies in a custom migration
 * (pnpm db:migration --name …), see docs/adr/0002-rls-strategy.md.
 */

// Tables that deliberately have RLS on but no policies: nobody but the server
// (adminDb, which bypasses RLS) may touch them. Each needs a reason.
const SERVER_ONLY_TABLES: Record<string, string> = {
  manage_tokens:
    "Manage-link token hashes; issued through private.mint_manage_token(), read by the server only",
  stripe_events: "Stripe webhook idempotency keys; written and read by the webhook only",
  ai_proposals:
    "AI receptionist proposals waiting for the customer to confirm; the chat and confirm routes only",
};

type TableInfo = {
  table: string;
  rls_enabled: boolean;
  policies: number;
  open_policies: string[];
};

const { db, close } = connectTestDb();

const tables = await db.execute<TableInfo>(sql`
  select
    c.relname as table,
    c.relrowsecurity as rls_enabled,
    count(p.policyname)::int as policies,
    coalesce(
      array_agg(p.policyname) filter (
        where p.roles && array['public', 'anon']::name[]
      ),
      '{}'
    ) as open_policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  group by c.relname, c.relrowsecurity
  order by c.relname
`);

describe("RLS coverage guard", () => {
  afterAll(() => close());

  it("found the schema's tables in the database", () => {
    expect(tables.length).toBeGreaterThan(10);
  });

  it.each(tables.map((t) => [t.table, t] as const))("%s has RLS enabled", (_name, t) => {
    expect(t.rls_enabled).toBe(true);
  });

  it.each(tables.map((t) => [t.table, t] as const))(
    "%s has policies (or is a listed server-only table)",
    (name, t) => {
      if (name in SERVER_ONLY_TABLES) {
        expect(t.policies, `${name} is server-only and must have no policies`).toBe(0);
      } else {
        expect(t.policies, `${name} has no RLS policies`).toBeGreaterThan(0);
      }
    },
  );

  it.each(tables.map((t) => [t.table, t] as const))(
    "%s has no policies for anon or public",
    (_name, t) => {
      // Signed-out paths use adminDb; a policy for anon/public would expose the
      // table through Supabase's REST API with the publishable key.
      expect(t.open_policies).toEqual([]);
    },
  );

  it.each(tables.map((t) => [t.table] as const))(
    "%s grants anon and authenticated no TRUNCATE, TRIGGER or REFERENCES",
    async (name) => {
      // TRUNCATE ignores RLS; nothing in the app needs the other two.
      const granted = await db.execute<{ grantee: string; privilege: string }>(sql`
        select grantee, privilege_type as privilege
        from information_schema.role_table_grants
        where table_schema = 'public' and table_name = ${name}
          and grantee in ('anon', 'authenticated')
          and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
      `);
      expect([...granted]).toEqual([]);
    },
  );

  it("tables created by migrations from now on don't get those privileges either", async () => {
    // pg_default_acl for the migration role (postgres): D = truncate, t = trigger, x = references.
    const [row] = await db.execute<{ acl: string }>(sql`
      select coalesce(array_to_string(defaclacl, ','), '') as acl
      from pg_default_acl
      where defaclnamespace = 'public'::regnamespace and defaclobjtype = 'r'
        and defaclrole = 'postgres'::regrole
    `);
    const entries = (row?.acl ?? "").split(",").filter(Boolean);
    for (const role of ["anon", "authenticated"]) {
      const entry = entries.find((e) => e.startsWith(`${role}=`));
      if (!entry) continue;
      const privileges = entry.slice(role.length + 1).split("/")[0]!;
      expect(privileges, role).not.toMatch(/[Dtx]/);
    }
  });

  it("server-only tables can't be read by anon or authenticated at all", async () => {
    for (const name of Object.keys(SERVER_ONLY_TABLES)) {
      const [row] = await db.execute<{ anon: boolean; authenticated: boolean }>(sql`
        select
          has_table_privilege('anon', ${`public.${name}`}, 'select') as anon,
          has_table_privilege('authenticated', ${`public.${name}`}, 'select') as authenticated
      `);
      expect(row, name).toEqual({ anon: false, authenticated: false });
    }
  });

  it("every Drizzle table with businessId exists in the database as a tenant table", async () => {
    // Catches a schema.ts table whose migration was never generated or applied.
    const fromSchema = (Object.values(schema) as unknown[])
      .filter((value): value is PgTable => is(value, PgTable))
      .map((table) => getTableConfig(table))
      .filter((config) => config.columns.some((column) => column.name === "business_id"))
      .map((config) => config.name)
      .sort();

    expect(await listTenantTables(db)).toEqual(expect.arrayContaining(fromSchema));
  });
});

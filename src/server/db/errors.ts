import "server-only";

type PgErrorFields = { code?: string; constraint_name?: string };

/** SQLSTATE and constraint of a Postgres error (Drizzle wraps it in `cause`). */
export function pgError(error: unknown): PgErrorFields {
  const e = error as PgErrorFields & { cause?: PgErrorFields };
  return {
    code: e?.cause?.code ?? e?.code,
    constraint_name: e?.cause?.constraint_name ?? e?.constraint_name,
  };
}

/** True for a unique violation (23505) on `constraint`. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const { code, constraint_name } = pgError(error);
  return code === "23505" && constraint_name === constraint;
}

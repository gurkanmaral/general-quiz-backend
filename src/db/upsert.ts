import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * `ON CONFLICT … DO UPDATE` guard: only touch the row when one of `columns` differs from the
 * incoming value, so re-importing unchanged content writes nothing (and keeps `updated_at`).
 */
export function anyChanged(columns: readonly PgColumn[]): SQL {
  return sql.join(
    columns.map((column) => sql`${column} is distinct from excluded.${sql.identifier(column.name)}`),
    sql` or `,
  );
}

/** `excluded.<column>` for `set:` clauses. */
export function excluded(column: PgColumn): SQL {
  return sql`excluded.${sql.identifier(column.name)}`;
}

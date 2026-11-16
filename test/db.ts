import { sql } from 'drizzle-orm';
import { MODULE_SCHEMAS, createDatabase, type Database, type Db } from '../src/db/client';

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set');
  return url;
}

export function openTestDatabase(): Database {
  return createDatabase(testDatabaseUrl());
}

/** Empties every table in the module schemas (AD-2), keeping the migrations table. */
export async function truncateAll(db: Db): Promise<void> {
  const result = await db.execute<{ name: string }>(sql`
    select format('%I.%I', schemaname, tablename) as name
    from pg_tables
    where schemaname in (${sql.join(MODULE_SCHEMAS.map((schema) => sql`${schema}`), sql`, `)})
  `);
  const names = result.rows.map((row) => row.name);
  if (names.length) await db.execute(sql.raw(`truncate table ${names.join(', ')} restart identity cascade`));
}

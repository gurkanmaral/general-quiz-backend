import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Database = { db: Db; pool: pg.Pool; close: () => Promise<void> };

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));

/** Module schemas owned by the app; tests truncate every table in them. */
export const MODULE_SCHEMAS = ['kno_accounts', 'kno_quizzes', 'kno_daily', 'kno_progress'] as const;

export function createDatabase(url: string): Database {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool, close: () => pool.end() };
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export async function pingDatabase(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}

/** The database or an open transaction; services accept either. */
export type DbExecutor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

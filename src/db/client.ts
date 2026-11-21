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
export const MODULE_SCHEMAS = ['kno_accounts', 'kno_quizzes', 'kno_daily', 'kno_progress', 'kno_social', 'kno_lobbies', 'kno_content'] as const;

export function createDatabase(url: string): Database {
  // A short connect timeout lets /health answer 503 instead of hanging when Postgres is down.
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5_000 });
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

/**
 * Runs `task` while holding a session-level Postgres advisory lock named `name`, so concurrent
 * API instances migrate and import one at a time (Story 6.4).
 */
export async function withAdvisoryLock<T>(pool: pg.Pool, name: string, task: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [name]);
    try {
      return await task();
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [name]);
    }
  } finally {
    client.release();
  }
}

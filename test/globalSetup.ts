import { runMigrations } from '../src/db/client';
import { openTestDatabase } from './db';

/** Applies migrations to the test database once per run. */
export default async function setup() {
  const database = openTestDatabase();
  try {
    await runMigrations(database.db);
  } finally {
    await database.close();
  }
}

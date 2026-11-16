import { beforeAll } from 'vitest';
import { openTestDatabase, truncateAll } from './db';

// Every test file starts from empty module tables.
beforeAll(async () => {
  const database = openTestDatabase();
  try {
    await truncateAll(database.db);
  } finally {
    await database.close();
  }
});

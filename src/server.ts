import { serve } from '@hono/node-server';
import { createDatabase, runMigrations } from './db/client';
import { loadEnv } from './env';
import { createApp } from './http/app';
import { createLogger } from './logger';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const database = createDatabase(env.DATABASE_URL);

await runMigrations(database.db);
logger.info('migrations applied');

const server = serve({ fetch: createApp({ db: database.db, logger }).fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, 'KNO. API listening');
});

const shutdown = () => {
  server.close(() => void database.close().then(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

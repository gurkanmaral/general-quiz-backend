import { serve } from '@hono/node-server';
import { createDatabase, runMigrations } from './db/client';
import { loadEnv } from './env';
import { createApp } from './http/app';
import { createLogger } from './logger';
import { attachRealtime } from './http/realtime';
import { startRarityJob } from './modules/progress';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const database = createDatabase(env.DATABASE_URL);

await runMigrations(database.db);
logger.info('migrations applied');

const trustedOrigins = env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://localhost:5180'];
const app = createApp({
  db: database.db,
  logger,
  auth: {
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Both local web ports (Vite default and start-kno.command) during development.
    trustedOrigins,
    trustedProxies: env.TRUST_PROXY,
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : undefined,
  },
});

// Rarity is precomputed at startup and every 24 h (FR-19, AD-11).
const rarityJob = startRarityJob(app.progress.computeRarity, logger);

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, 'KNO. API listening');
});
// Socket.IO shares the HTTP server and the session cookie (AD-1, AD-12).
const io = attachRealtime(server as import('node:http').Server, app, { trustedOrigins: [env.BETTER_AUTH_URL, ...trustedOrigins], logger });

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return; // a second Ctrl-C must not end the pool twice
  shuttingDown = true;
  rarityJob.stop();
  io.disconnectSockets(true);
  server.close(() => void database.close().then(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

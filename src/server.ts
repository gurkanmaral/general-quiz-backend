import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createDatabase, runMigrations, withAdvisoryLock } from './db/client';
import { DEV_TEST_CODE, loadEnv } from './env';
import { createApp } from './http/app';
import { createLogger } from './logger';
import { attachRealtime } from './http/realtime';
import { createMailer } from './modules/accounts';
import { importContent } from './modules/content';
import { startRarityJob } from './modules/progress';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const database = createDatabase(env.DATABASE_URL);
const production = env.NODE_ENV === 'production';

// Several instances may start at once: one at a time migrates and imports (Story 6.4).
const importOnStart = env.IMPORT_ON_START ? env.IMPORT_ON_START === 'true' : production;
await withAdvisoryLock(database.pool, 'kno:startup', async () => {
  await runMigrations(database.db);
  logger.info('migrations applied');
  if (!importOnStart) return;
  const report = await importContent(database.db, env.CONTENT_DIR);
  logger.info({ dir: env.CONTENT_DIR, pending: report.skippedPending }, 'content imported');
  for (const warning of report.warnings) logger.warn(warning);
});

if (production && !env.RESEND_API_KEY) logger.warn('RESEND_API_KEY is not set: sign-in emails are only logged');
const webDir = env.WEB_DIR;
if (webDir && !existsSync(webDir)) logger.warn({ webDir }, 'web build not found: run `npm run build` first');

const trustedOrigins = production ? [] : ['http://localhost:5173', 'http://localhost:5180'];
const app = createApp({
  db: database.db,
  logger,
  webDir: webDir && existsSync(webDir) ? webDir : undefined,
  auth: {
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Both local web ports (Vite default and start-kno.command) during development.
    trustedOrigins,
    trustedProxies: env.TRUST_PROXY,
    mailer: createMailer(env, logger),
    testCode: production ? undefined : (env.AUTH_TEST_CODE ?? DEV_TEST_CODE),
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : undefined,
  },
});

// Rarity is precomputed at startup and every 24 h (FR-19, AD-11).
const rarityJob = startRarityJob(app.progress.computeRarity, logger);

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, web: Boolean(webDir) }, 'KNO. API listening');
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

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { HealthResponse } from '@general-quiz/contracts';
import { pingDatabase, type Db } from '../db/client';
import type { Logger } from '../logger';
import { DEFAULT_AUTH_URL, DEV_AUTH_SECRET } from '../env';
import { AUTH_BASE_PATH, createAccounts, createDevMailer, type AuthConfig } from '../modules/accounts';
import { createDailyService, dailyRoutes } from '../modules/daily';
import { getPublishedQuestion } from '../modules/quizzes';
import { problem } from './problem';

export type AppDeps = {
  db: Db;
  logger: Logger;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Better Auth settings; defaults suit tests and local dev (dev mailer, dev secret). */
  auth?: Partial<AuthConfig>;
};

/** Builds the HTTP app without listening, so tests call `app.request(...)` directly. */
export function createApp({ db, logger, now = () => new Date(), auth }: AppDeps) {
  const accounts = createAccounts(
    db,
    { baseURL: DEFAULT_AUTH_URL, secret: DEV_AUTH_SECRET, ...auth, mailer: auth?.mailer ?? createDevMailer(logger) },
    logger,
  );
  const daily = createDailyService(db, (slug) => getPublishedQuestion(db, slug));

  const app = new Hono();

  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    logger.debug({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - started) }, 'request');
  });

  app.get('/health', async (c) => {
    await pingDatabase(db);
    return c.json({ status: 'ok', database: 'ok' } satisfies HealthResponse);
  });

  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, (c) => accounts.authHandler(c.req.raw));
  app.route('/api/v1/auth', accounts.providerRoutes());
  app.route('/api/v1/me', accounts.meRoutes());
  app.route('/api/v1/daily', dailyRoutes(daily, now));

  app.notFound((c) => problem(c, { status: 404, code: 'http.notFound', title: 'Not found' }));
  app.onError((error, c) => {
    // Thrown by helpers such as `requireUser` with a ready problem+json response.
    if (error instanceof HTTPException) return error.getResponse();
    logger.error({ err: error, path: c.req.path }, 'unhandled error');
    return problem(c, { status: 500, code: 'http.internal', title: 'Internal server error' });
  });

  return Object.assign(app, { accounts });
}

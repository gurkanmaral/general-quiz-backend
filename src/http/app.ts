import { Hono } from 'hono';
import type { HealthResponse } from '@general-quiz/contracts';
import { pingDatabase, type Db } from '../db/client';
import type { Logger } from '../logger';
import { createDailyService, dailyRoutes } from '../modules/daily';
import { getPublishedQuestion } from '../modules/quizzes';
import { problem } from './problem';

export type AppDeps = {
  db: Db;
  logger: Logger;
  /** Injectable clock for tests. */
  now?: () => Date;
};

/** Builds the HTTP app without listening, so tests call `app.request(...)` directly. */
export function createApp({ db, logger, now = () => new Date() }: AppDeps) {
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

  app.route('/api/v1/daily', dailyRoutes(daily, now));

  app.notFound((c) => problem(c, { status: 404, code: 'http.notFound', title: 'Not found' }));
  app.onError((error, c) => {
    logger.error({ err: error, path: c.req.path }, 'unhandled error');
    return problem(c, { status: 500, code: 'http.internal', title: 'Internal server error' });
  });

  return app;
}

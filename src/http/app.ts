import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { HealthResponse } from '@general-quiz/contracts';
import { pingDatabase, type Db } from '../db/client';
import type { Logger } from '../logger';
import { DEFAULT_AUTH_URL, DEV_AUTH_SECRET } from '../env';
import { AUTH_BASE_PATH, createAccounts, createDevMailer, type AuthConfig } from '../modules/accounts';
import { createDailyService, dailyPlayerIds, dailyRoutes, deleteDailyUserData, isTodaySomewhere } from '../modules/daily';
import { createProgress, deleteProgressUserData, playerRoutes, profileRoutes, type Progress, type RecordedGameResult } from '../modules/progress';
import { createSocial, deleteSocialUserData, friendsRoutes, linkRoutes } from '../modules/social';
import { createSoloGames, deleteQuizzesUserData, getPublishedQuestion, quizzesRoutes, soloGameRoutes, soloPlayerIds, type Random } from '../modules/quizzes';
import { problem } from './problem';

export type AppDeps = {
  db: Db;
  logger: Logger;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Injectable randomness (Solo Game draws) for tests. */
  random?: Random;
  /** Better Auth settings; defaults suit tests and local dev (dev mailer, dev secret). */
  auth?: Partial<AuthConfig>;
};

/** Builds the HTTP app without listening, so tests call `app.request(...)` directly. */
export function createApp({ db, logger, now = () => new Date(), random, auth }: AppDeps) {
  const accounts = createAccounts(
    db,
    { baseURL: DEFAULT_AUTH_URL, secret: DEV_AUTH_SECRET, ...auth, mailer: auth?.mailer ?? createDevMailer(logger) },
    logger,
    // Every module with per-player rows (FR-4).
    [deleteDailyUserData, deleteQuizzesUserData, deleteProgressUserData, deleteSocialUserData],
    // `/me` shows the equipped Title (FR-18); progress is created below, so look it up lazily.
    { equippedTitle: (userId) => progress.equippedTitle(userId) },
  );
  const daily = createDailyService(db, (slug) => getPublishedQuestion(db, slug));
  // Ranked Accounts: finished a Daily or a Solo Game (Lobby Games join in Epic 5).
  const progress: Progress = createProgress(db, [dailyPlayerIds, soloPlayerIds]);
  const games = createSoloGames(db, {
    now,
    random,
    // Questions not yet answered correctly come first, so replaying moves toward mastery (Story 2.4).
    preferredQuestions: async (tx, userId, quizSlug) => {
      const correct = await progress.correctQuestionSlugs(tx, userId, quizSlug);
      return { has: (slug: string) => !correct.has(slug) };
    },
    onGameEnded: (tx, game) => progress.recordGame(tx, game),
  });
  const social = createSocial(db, {
    now,
    directory: {
      findPlayer: accounts.service.findPlayer,
      findPlayers: accounts.service.findPlayers,
      titlesOf: (ids) => progress.equippedTitles(ids),
    },
  });
  const quizzesDeps = {
    db,
    games,
    optionalUser: accounts.optionalUser,
    requireUser: accounts.requireUser,
    quizRecords: progress.quizRecords,
    endedResponse: (ended: RecordedGameResult) => ({ record: ended.record, unlocks: ended.unlocks }),
  };

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
  app.route('/api/v1/daily', dailyRoutes(daily, now, accounts.requireUser));
  app.route('/api/v1/quizzes', quizzesRoutes(quizzesDeps));
  app.route('/api/v1/solo-games', soloGameRoutes(quizzesDeps));
  const profileDeps = {
    db,
    requireUser: accounts.requireUser,
    findPlayer: accounts.service.findPlayer,
    streakOf: async (userId: string, today: string) =>
      isTodaySomewhere(today, now()) ? (await daily.getHistory(userId, today)).streak : undefined,
    // Friends may see each other's Profiles (FR-20).
    canViewProfile: (viewerId: string, playerId: string) => social.areFriends(viewerId, playerId),
  };
  app.route('/api/v1/profile', profileRoutes(profileDeps));
  app.route('/api/v1/players', playerRoutes(profileDeps));
  app.route('/api/v1/friends', friendsRoutes({ social, requireUser: accounts.requireUser }));
  app.route('/api/v1/links', linkRoutes({ social }));

  app.notFound((c) => problem(c, { status: 404, code: 'http.notFound', title: 'Not found' }));
  app.onError((error, c) => {
    // Thrown by helpers such as `requireUser` with a ready problem+json response.
    if (error instanceof HTTPException) return error.getResponse();
    logger.error({ err: error, path: c.req.path }, 'unhandled error');
    return problem(c, { status: 500, code: 'http.internal', title: 'Internal server error' });
  });

  return Object.assign(app, { accounts, progress, social });
}

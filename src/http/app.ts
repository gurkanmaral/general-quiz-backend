import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { RATE_LIMITED_CODE, type HealthResponse, type UnlockedAward } from '@general-quiz/contracts';
import { pingDatabase, type Db } from '../db/client';
import type { Logger } from '../logger';
import { DEFAULT_AUTH_URL, DEV_AUTH_SECRET } from '../env';
import { AUTH_BASE_PATH, createAccounts, createDevMailer, type AuthConfig } from '../modules/accounts';
import { createDailyService, dailyPlayerIds, dailyRoutes, deleteDailyUserData, isTodaySomewhere } from '../modules/daily';
import { createProgress, deleteProgressUserData, playerRoutes, profileRoutes, type Progress, type RecordedGameResult } from '../modules/progress';
import { createSocial, deleteSocialUserData, friendsRoutes, linkRoutes, notificationRoutes, socialSettingsRoutes } from '../modules/social';
import { createLobbyHub, deleteLobbiesUserData, lobbyPlayerIds, lobbyRoutes, playedTogether, saveLobbyGame, type Clock } from '../modules/lobbies';
import { createSoloGames, deleteQuizzesUserData, drawQuestions, getPublishedQuestion, publishedDailyPoolSlugs, playableQuiz, quizzesRoutes, soloGameRoutes, soloPlayerIds, type Random } from '../modules/quizzes';
import { problem } from './problem';
import { createRateLimiter, rateLimitWith } from './rateLimit';
import { serveWeb } from './static';
import { reportRoutes } from '../modules/content';

export type AppDeps = {
  db: Db;
  logger: Logger;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Injectable randomness (Solo Game draws) for tests. */
  random?: Random;
  /** Injectable server clock and timers for Lobbies (AD-8) in tests. */
  lobbyClock?: Clock;
  /** The built web app to serve on the same origin (production, Story 6.4). */
  webDir?: string;
  /** Better Auth settings; defaults suit tests and local dev (dev mailer, dev secret). */
  auth?: Partial<AuthConfig>;
};

/** Builds the HTTP app without listening, so tests call `app.request(...)` directly. */
export function createApp({ db, logger, now = () => new Date(), random, auth, lobbyClock, webDir }: AppDeps) {
  const accounts = createAccounts(
    db,
    { baseURL: DEFAULT_AUTH_URL, secret: DEV_AUTH_SECRET, ...auth, mailer: auth?.mailer ?? createDevMailer(logger) },
    logger,
    // Every module with per-player rows (FR-4).
    [deleteDailyUserData, deleteQuizzesUserData, deleteProgressUserData, deleteSocialUserData, deleteLobbiesUserData],
    // `/me` shows the equipped Title (FR-18); progress is created below, so look it up lazily.
    { equippedTitle: (userId) => progress.equippedTitle(userId) },
  );
  const daily = createDailyService(db, (slug) => getPublishedQuestion(db, slug), () => publishedDailyPoolSlugs(db));
  // Ranked Accounts: finished a Daily, a Solo Game or a Lobby Game.
  const progress: Progress = createProgress(db, [dailyPlayerIds, soloPlayerIds, lobbyPlayerIds]);
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
  const lobbies = createLobbyHub({
    clock: lobbyClock,
    playerCard: async (userId) => {
      const player = await accounts.service.findPlayer({ id: userId });
      return player ? { ...player, title: await progress.equippedTitle(userId) } : undefined;
    },
    quiz: (slug) => playableQuiz(db, slug),
    questions: (slug, count) => drawQuestions(db, slug, count, random),
    // Lobby Games update Quiz Records, Badges and Titles through `progress` (AD-8, FR-34); one transaction.
    recordGame: (result) =>
      db.transaction(async (tx) => {
        const endedAt = now();
        await saveLobbyGame(tx, {
          code: result.code,
          quizSlug: result.quizSlug,
          questionCount: result.questionCount,
          endedAt,
          players: result.standings.map(({ userId, score, correct, rank }) => ({ userId, score, correct, rank })),
        });
        const unlocks = new Map<string, UnlockedAward[]>();
        for (const standing of result.standings) {
          const answers = result.outcomes.get(standing.userId) ?? [];
          if (answers.length === 0) continue;
          const recorded = await progress.recordGame(tx, {
            userId: standing.userId,
            quizSlug: result.quizSlug,
            status: 'finished',
            score: standing.correct,
            total: result.questionCount,
            endedAt,
            answers,
          });
          unlocks.set(standing.userId, recorded.unlocks);
        }
        return unlocks;
      }),
    onError: (error) => logger.error({ err: error }, 'lobby game could not be recorded'),
  });
  const quizzesDeps = {
    db,
    games,
    optionalUser: accounts.optionalUser,
    requireUser: accounts.requireUser,
    quizRecords: progress.quizRecords,
    endedResponse: (ended: RecordedGameResult) => ({ record: ended.record, unlocks: ended.unlocks }),
  };

  // Per-account rate limits (Stories 6.1, 6.3), one counter store per app.
  const limiter = createRateLimiter(now);
  const rateLimit = rateLimitWith(limiter);
  const app = new Hono();

  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    logger.debug({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - started) }, 'request');
  });

  app.get('/health', async (c) => {
    try {
      await pingDatabase(db);
    } catch (error) {
      logger.warn({ err: error }, 'health check: database unreachable');
      return c.json({ status: 'error', database: 'down' } satisfies HealthResponse, 503);
    }
    return c.json({ status: 'ok', database: 'ok' } satisfies HealthResponse);
  });

  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, async (c) => {
    const res = await accounts.authHandler(c.req.raw);
    if (res.status !== 429) return res;
    // Better Auth's limiter (by client IP) answers like every other limit: problem+json `rateLimited` (Story 6.3).
    const retryAfter = res.headers.get('X-Retry-After') ?? res.headers.get('Retry-After') ?? '60';
    const limited = problem(c, { status: 429, code: RATE_LIMITED_CODE, title: 'Too many requests', detail: `Try again in ${retryAfter} seconds.` });
    limited.headers.set('Retry-After', retryAfter);
    return limited;
  });
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
    // Friends and Lobby co-players may see each other's Profiles (FR-20).
    canViewProfile: async (viewerId: string, playerId: string) =>
      lobbies.together(viewerId, playerId) || (await social.areFriends(viewerId, playerId)) || (await playedTogether(db, viewerId, playerId)),
  };
  app.route('/api/v1/profile', profileRoutes(profileDeps));
  app.route('/api/v1/players', playerRoutes(profileDeps));
  app.route('/api/v1/friends', friendsRoutes({ social, requireUser: accounts.requireUser, isToday: (date) => isTodaySomewhere(date, now()), rateLimit }));
  app.route('/api/v1/links', linkRoutes({ social, optionalUser: accounts.optionalUser }));
  app.route('/api/v1/lobbies', lobbyRoutes({ hub: lobbies, requireUser: accounts.requireUser, invite: social.inviteToLobby, rateLimit }));
  app.route('/api/v1/social', socialSettingsRoutes({ social, requireUser: accounts.requireUser }));
  app.route(
    '/api/v1/reports',
    reportRoutes({ db, now, requireUser: accounts.requireUser, rateLimit, questionExists: async (slug) => Boolean(await getPublishedQuestion(db, slug)) }),
  );
  app.route('/api/v1/notifications', notificationRoutes({ social, requireUser: accounts.requireUser }));

  if (webDir) app.use(serveWeb(webDir));

  app.notFound((c) => problem(c, { status: 404, code: 'http.notFound', title: 'Not found' }));
  app.onError((error, c) => {
    // Thrown by helpers such as `requireUser` with a ready problem+json response.
    if (error instanceof HTTPException) return error.getResponse();
    logger.error({ err: error, path: c.req.path }, 'unhandled error');
    return problem(c, { status: 500, code: 'http.internal', title: 'Internal server error' });
  });

  return Object.assign(app, { accounts, progress, social, lobbies, limiter });
}

import { Hono, type Context } from 'hono';
import { QUIZZES_PROBLEM_CODES, SoloAnswerBodySchema, type QuizListResponse, type SoloAnswerResponse } from '@general-quiz/contracts';
import type { DbExecutor } from '../../db/client';
import { problem } from '../../http/problem';
import type { SoloGames } from './games';
import { listPublishedQuizzes } from './service';

export type SessionLookup = (c: Context) => Promise<{ id: string } | undefined>;
export type RequireUser = (c: Context) => Promise<{ id: string }>;

export type QuizzesRouteDeps<T> = {
  db: DbExecutor;
  games: SoloGames<T>;
  /** The signed-in player or undefined / a thrown 401 (from the accounts module, AD-12). */
  optionalUser: SessionLookup;
  requireUser: RequireUser;
  /** Extra fields for the answer that ends a game (e.g. unlocks from `progress`). */
  endedResponse?: (ended: T) => Record<string, unknown>;
};

/** `/api/v1/quizzes`: the Quizzes page (public) and starting a Solo Game (signed in). */
export function quizzesRoutes<T>({ db, games, optionalUser, requireUser }: QuizzesRouteDeps<T>) {
  return new Hono()
    .get('/', async (c) => {
      const [quizzes, user] = await Promise.all([listPublishedQuizzes(db), optionalUser(c)]);
      const best = user ? await games.bestResults(user.id) : new Map();
      const body: QuizListResponse = { quizzes: quizzes.map((item) => ({ ...item, best: best.get(item.slug) ?? null })) };
      return c.json(body);
    })
    .post('/:slug/games', async (c) => {
      const user = await requireUser(c);
      const game = await games.start(user.id, c.req.param('slug'));
      if (!game) return problem(c, { status: 404, code: QUIZZES_PROBLEM_CODES.notFound, title: 'Quiz not found', detail: 'No published Quiz has this slug.' });
      return c.json(game, 201);
    });
}

const ANSWER_PROBLEMS = {
  gameNotFound: { status: 404, code: QUIZZES_PROBLEM_CODES.gameNotFound, title: 'Game not found' },
  gameOver: { status: 409, code: QUIZZES_PROBLEM_CODES.gameOver, title: 'Game over', detail: 'This game is finished or was replaced by a newer game.' },
  alreadyAnswered: { status: 409, code: QUIZZES_PROBLEM_CODES.alreadyAnswered, title: 'Already answered', detail: 'The first answer counts.' },
  wrongPosition: { status: 422, code: QUIZZES_PROBLEM_CODES.wrongPosition, title: 'Not the next question', detail: 'Answer the Questions in order.' },
} as const;

/** `/api/v1/solo-games`: answering a Solo Game (signed in, own games only). */
export function soloGameRoutes<T>({ games, requireUser, endedResponse }: QuizzesRouteDeps<T>) {
  return new Hono().post('/:gameId/answers', async (c) => {
    const user = await requireUser(c);
    const body = SoloAnswerBodySchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) {
      return problem(c, { status: 400, code: QUIZZES_PROBLEM_CODES.invalidAnswer, title: 'Invalid answer', detail: 'Send { position, selectedIndex: 0-3 }.' });
    }
    const outcome = await games.answer(user.id, c.req.param('gameId'), body.data);
    if (!outcome.ok) return problem(c, ANSWER_PROBLEMS[outcome.reason]);
    const extra = outcome.ended !== undefined && endedResponse ? endedResponse(outcome.ended) : {};
    return c.json({ ...outcome.response, ...extra } satisfies SoloAnswerResponse);
  });
}

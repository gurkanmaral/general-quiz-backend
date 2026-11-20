import { Hono, type Context } from 'hono';
import type { QuizListResponse } from '@general-quiz/contracts';
import type { DbExecutor } from '../../db/client';
import { listPublishedQuizzes } from './service';

export type SessionLookup = (c: Context) => Promise<{ id: string } | undefined>;

export type QuizzesRouteDeps = {
  db: DbExecutor;
  /** The signed-in player or undefined (from the accounts module, AD-12). */
  optionalUser: SessionLookup;
};

/** `/api/v1/quizzes`: the Quizzes page (public). */
export function quizzesRoutes({ db }: QuizzesRouteDeps) {
  return new Hono().get('/', async (c) => {
    const quizzes = await listPublishedQuizzes(db);
    const body: QuizListResponse = { quizzes: quizzes.map((item) => ({ ...item, best: null })) };
    return c.json(body);
  });
}

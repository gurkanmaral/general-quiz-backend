import { and, eq, inArray, sql } from 'drizzle-orm';
import type { QuestionDifficulty, QuizRecord } from '@general-quiz/contracts';
import type { Db, DbExecutor } from '../../db/client';
import { publishedQuestionIndex, type EndedSoloGame } from '../quizzes';
import { correctQuestion, quizRecord } from './schema';

/** A Solo Game counts as won when at least this share of its Questions was answered correctly. */
export const SOLO_WIN_SHARE = 0.7;

/** A finished or abandoned game as `progress` records it (Solo now, Lobby games later). */
export type RecordedGame = Pick<EndedSoloGame, 'userId' | 'quizSlug' | 'status' | 'score' | 'total'> & {
  answers: readonly { questionSlug: string; correct: boolean }[];
};

export function isWon(game: Pick<RecordedGame, 'status' | 'score' | 'total'>): boolean {
  return game.status === 'finished' && game.total > 0 && game.score / game.total >= SOLO_WIN_SHARE;
}

/** The Quiz Record from stored rows, counted against the Quiz's currently published Questions. */
export function toQuizRecord(
  row: { gamesPlayed: number; gamesWon: number },
  correct: ReadonlySet<string>,
  published: ReadonlyMap<string, QuestionDifficulty>,
): QuizRecord {
  let correctStandard = 0;
  let correctExpert = 0;
  for (const slug of correct) {
    const difficulty = published.get(slug);
    if (difficulty === 'standard') correctStandard += 1;
    if (difficulty === 'expert') correctExpert += 1;
  }
  return {
    gamesPlayed: row.gamesPlayed,
    gamesWon: row.gamesWon,
    correctStandard,
    correctExpert,
    correctShare: published.size ? (correctStandard + correctExpert) / published.size : 0,
  };
}

/** Distinct Questions a player has ever answered correctly in one Quiz. */
export async function correctQuestionSlugs(db: DbExecutor, userId: string, quizSlug: string): Promise<Set<string>> {
  const rows = await db
    .select({ slug: correctQuestion.questionSlug })
    .from(correctQuestion)
    .where(and(eq(correctQuestion.userId, userId), eq(correctQuestion.quizSlug, quizSlug)));
  return new Set(rows.map((row) => row.slug));
}

/** The player's Quiz Records for every Quiz they have played (or only `quizSlugs`). */
export async function quizRecords(db: DbExecutor, userId: string, quizSlugs?: readonly string[]): Promise<Map<string, QuizRecord>> {
  const quizFilter = (column: typeof quizRecord.quizSlug | typeof correctQuestion.quizSlug) =>
    quizSlugs ? inArray(column, [...quizSlugs]) : undefined;
  const rows = await db.select().from(quizRecord).where(and(eq(quizRecord.userId, userId), quizFilter(quizRecord.quizSlug)));
  if (rows.length === 0) return new Map();
  const slugs = rows.map((row) => row.quizSlug);
  const [correctRows, published] = await Promise.all([
    db
      .select({ quizSlug: correctQuestion.quizSlug, slug: correctQuestion.questionSlug })
      .from(correctQuestion)
      .where(and(eq(correctQuestion.userId, userId), inArray(correctQuestion.quizSlug, slugs))),
    publishedQuestionIndex(db, slugs),
  ]);
  const correct = new Map<string, Set<string>>();
  for (const row of correctRows) correct.set(row.quizSlug, (correct.get(row.quizSlug) ?? new Set()).add(row.slug));
  return new Map(rows.map((row) => [row.quizSlug, toQuizRecord(row, correct.get(row.quizSlug) ?? new Set(), published.get(row.quizSlug) ?? new Map())]));
}

/**
 * Updates the Quiz Record after a finished or abandoned game (FR-15): every correctly answered
 * Question joins the distinct set, and the game counts as played (and won) when it has answers.
 * Runs in the game's transaction.
 */
export async function recordGame(db: DbExecutor, game: RecordedGame): Promise<QuizRecord> {
  if (game.answers.length > 0) {
    const correct = game.answers.filter((answer) => answer.correct);
    if (correct.length) {
      await db
        .insert(correctQuestion)
        .values(correct.map((answer) => ({ userId: game.userId, quizSlug: game.quizSlug, questionSlug: answer.questionSlug })))
        .onConflictDoNothing();
    }
    const won = isWon(game) ? 1 : 0;
    await db
      .insert(quizRecord)
      .values({ userId: game.userId, quizSlug: game.quizSlug, gamesPlayed: 1, gamesWon: won })
      .onConflictDoUpdate({
        target: [quizRecord.userId, quizRecord.quizSlug],
        set: {
          gamesPlayed: sql`${quizRecord.gamesPlayed} + 1`,
          gamesWon: sql`${quizRecord.gamesWon} + ${won}`,
          updatedAt: sql`now()`,
        },
      });
  }
  const records = await quizRecords(db, game.userId, [game.quizSlug]);
  return records.get(game.quizSlug) ?? { gamesPlayed: 0, gamesWon: 0, correctStandard: 0, correctExpert: 0, correctShare: 0 };
}

/** Account deletion (FR-4): every progress row of the player. */
export async function deleteProgressUserData(db: DbExecutor, userId: string): Promise<void> {
  await db.delete(correctQuestion).where(eq(correctQuestion.userId, userId));
  await db.delete(quizRecord).where(eq(quizRecord.userId, userId));
}

export function createProgress(db: Db) {
  return {
    recordGame: (tx: DbExecutor, game: RecordedGame) => recordGame(tx, game),
    quizRecords: (userId: string, quizSlugs?: readonly string[]) => quizRecords(db, userId, quizSlugs),
    correctQuestionSlugs: (tx: DbExecutor, userId: string, quizSlug: string) => correctQuestionSlugs(tx, userId, quizSlug),
  };
}
export type Progress = ReturnType<typeof createProgress>;

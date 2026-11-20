import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  SOLO_GAME_SIZE,
  type BestResult,
  type QuestionCategory,
  type QuestionDifficulty,
  type QuestionTheme,
  type SoloAnswerBody,
  type SoloAnswerResponse,
  type SoloGameResponse,
} from '@general-quiz/contracts';
import type { Db, DbExecutor } from '../../db/client';
import { uuidv7 } from '../../db/ids';
import { question, quiz, soloAnswer, soloGame } from './schema';

export type Random = () => number;

type PoolQuestion = { slug: string; difficulty: QuestionDifficulty };

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/**
 * Draws a Solo Game (FR-14): `size` Questions, `expertShare` of them Expert (rounded), topped up
 * from the other Difficulty when one runs short. Within a Difficulty, `preferred` Questions (e.g.
 * not yet answered correctly) come first, so repeated play moves a player toward mastery.
 */
export function pickQuestions(
  pool: readonly PoolQuestion[],
  expertShare: number,
  random: Random,
  preferred: (slug: string) => boolean = () => false,
  size = SOLO_GAME_SIZE,
): string[] {
  const ranked = (difficulty: QuestionDifficulty) => {
    const items = shuffle(pool.filter((item) => item.difficulty === difficulty).map((item) => item.slug), random);
    return [...items.filter(preferred), ...items.filter((slug) => !preferred(slug))];
  };
  const experts = ranked('expert');
  const standards = ranked('standard');
  const total = Math.min(size, pool.length);
  let expertCount = Math.min(experts.length, Math.round(total * expertShare));
  const standardCount = Math.min(standards.length, total - expertCount);
  expertCount = Math.min(experts.length, total - standardCount);
  return shuffle([...experts.slice(0, expertCount), ...standards.slice(0, standardCount)], random);
}

/** What `progress` needs about an ended game (finished, or abandoned with answers). */
export type EndedSoloGame = {
  userId: string;
  quizSlug: string;
  status: 'finished' | 'abandoned';
  score: number;
  total: number;
  /** When the game was finished or abandoned (the app clock). */
  endedAt: Date;
  answers: readonly { questionSlug: string; difficulty: QuestionDifficulty; correct: boolean }[];
};

/** Called inside the game's transaction when a game ends; its result is returned with the last answer. */
export type GameEndedHook<T> = (db: DbExecutor, game: EndedSoloGame) => Promise<T>;

export type AnswerOutcome<T> =
  | { ok: true; response: SoloAnswerResponse; ended?: T }
  | { ok: false; reason: 'gameNotFound' | 'gameOver' | 'alreadyAnswered' | 'wrongPosition' };

export type SoloGamesDeps<T> = {
  now?: () => Date;
  random?: Random;
  /** Questions to draw first for a player (e.g. not yet answered correctly). */
  preferredQuestions?: (db: DbExecutor, userId: string, quizSlug: string) => Promise<{ has: (slug: string) => boolean }>;
  onGameEnded?: GameEndedHook<T>;
};

type GameRow = typeof soloGame.$inferSelect;

export function createSoloGames<T = undefined>(db: Db, deps: SoloGamesDeps<T> = {}) {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;

  async function endedGame(tx: DbExecutor, game: GameRow, status: EndedSoloGame['status']): Promise<EndedSoloGame> {
    const answers = await tx
      .select({ questionSlug: soloAnswer.questionSlug, correct: soloAnswer.correct, difficulty: question.difficulty })
      .from(soloAnswer)
      .innerJoin(question, eq(question.slug, soloAnswer.questionSlug))
      .where(eq(soloAnswer.gameId, game.id))
      .orderBy(soloAnswer.position);
    return { userId: game.userId, quizSlug: game.quizSlug, status, score: game.score, total: game.questionSlugs.length, endedAt: game.endedAt ?? now(), answers };
  }

  return {
    /**
     * Starts a Solo Game: abandons the player's active games (their answers still count, FR-15),
     * draws the Questions and returns them without correct options or stories (AD-7).
     * Undefined when the Quiz is not a published, listed Quiz with published Questions.
     */
    async start(userId: string, quizSlug: string): Promise<SoloGameResponse | undefined> {
      return db.transaction(async (tx) => {
        const [found] = await tx
          .select()
          .from(quiz)
          .where(and(eq(quiz.slug, quizSlug), eq(quiz.status, 'published'), eq(quiz.kind, 'quiz')))
          .limit(1);
        if (!found?.category || !found.theme) return undefined;
        const pool = await tx
          .select({ slug: question.slug, difficulty: question.difficulty })
          .from(question)
          .where(and(eq(question.quizSlug, quizSlug), eq(question.status, 'published')));
        if (pool.length === 0) return undefined;

        const at = now();
        const abandoned = await tx
          .update(soloGame)
          .set({ status: 'abandoned', endedAt: at })
          .where(and(eq(soloGame.userId, userId), eq(soloGame.status, 'active')))
          .returning();
        for (const game of abandoned) {
          if (game.answered > 0 && deps.onGameEnded) await deps.onGameEnded(tx, await endedGame(tx, game, 'abandoned'));
        }

        const preferred = deps.preferredQuestions ? await deps.preferredQuestions(tx, userId, quizSlug) : { has: () => false };
        const slugs = pickQuestions(pool, found.expertShare, random, (slug) => preferred.has(slug));
        const gameId = uuidv7(at.getTime());
        await tx.insert(soloGame).values({ id: gameId, userId, quizSlug, questionSlugs: slugs, startedAt: at });

        const rows = await tx.select().from(question).where(inArray(question.slug, slugs));
        const bySlug = new Map(rows.map((row) => [row.slug, row]));
        return {
          gameId,
          quiz: { slug: found.slug, title: found.title, category: found.category as QuestionCategory, theme: found.theme as QuestionTheme },
          questions: slugs.map((slug, position) => {
            const row = bySlug.get(slug)!;
            return { position, slug, difficulty: row.difficulty, eyebrow: row.content.eyebrow, text: row.content.text, options: row.content.options };
          }),
        };
      });
    },

    /**
     * Records the answer to the next Question (first answer final), decides correctness on the
     * server (AD-3) and reveals the correct option and story. The last answer finishes the game.
     */
    async answer(userId: string, gameId: string, body: SoloAnswerBody): Promise<AnswerOutcome<T>> {
      return db.transaction(async (tx) => {
        const [game] = await tx
          .select()
          .from(soloGame)
          .where(and(eq(soloGame.id, gameId), eq(soloGame.userId, userId)))
          .for('update')
          .limit(1);
        if (!game) return { ok: false, reason: 'gameNotFound' };
        if (game.status !== 'active') return { ok: false, reason: 'gameOver' };
        if (body.position < game.answered) return { ok: false, reason: 'alreadyAnswered' };
        if (body.position > game.answered || body.position >= game.questionSlugs.length) return { ok: false, reason: 'wrongPosition' };

        const questionSlug = game.questionSlugs[body.position]!;
        const [row] = await tx.select().from(question).where(eq(question.slug, questionSlug)).limit(1);
        if (!row) throw new Error(`Solo game ${gameId} names an unknown question ${questionSlug}`);
        const correct = body.selectedIndex === row.correctIndex;
        const at = now();
        await tx.insert(soloAnswer).values({ gameId, position: body.position, questionSlug, selectedIndex: body.selectedIndex, correct, answeredAt: at });

        const finished = body.position + 1 === game.questionSlugs.length;
        const [updated] = await tx
          .update(soloGame)
          .set({
            answered: sql`${soloGame.answered} + 1`,
            score: sql`${soloGame.score} + ${correct ? 1 : 0}`,
            ...(finished ? { status: 'finished' as const, endedAt: at } : {}),
          })
          .where(eq(soloGame.id, gameId))
          .returning();
        const ended = finished && deps.onGameEnded ? await deps.onGameEnded(tx, await endedGame(tx, updated!, 'finished')) : undefined;
        return {
          ok: true,
          ended,
          response: {
            position: body.position,
            correct,
            correctIndex: row.correctIndex,
            answerTitle: row.content.answerTitle,
            summary: row.content.summary,
            facts: row.content.facts,
            source: row.content.source,
            score: updated!.score,
            result: finished ? { score: updated!.score, total: updated!.questionSlugs.length } : null,
            record: null,
            unlocks: [],
          },
        };
      });
    },

    /** The player's best finished Solo Game per Quiz (highest share correct, then most recent). */
    async bestResults(userId: string): Promise<Map<string, BestResult>> {
      const rows = await db
        .selectDistinctOn([soloGame.quizSlug], {
          quizSlug: soloGame.quizSlug,
          score: soloGame.score,
          total: sql<number>`cardinality(${soloGame.questionSlugs})`.mapWith(Number),
        })
        .from(soloGame)
        .where(and(eq(soloGame.userId, userId), eq(soloGame.status, 'finished')))
        .orderBy(
          soloGame.quizSlug,
          sql`${soloGame.score}::float / cardinality(${soloGame.questionSlugs}) desc`,
          sql`${soloGame.endedAt} desc`,
        );
      return new Map(rows.map((row) => [row.quizSlug, { score: row.score, total: row.total }]));
    },
  };
}

export type SoloGames<T = undefined> = ReturnType<typeof createSoloGames<T>>;

/** Account deletion (FR-4): the player's Solo Games and answers. */
export async function deleteQuizzesUserData(db: DbExecutor, userId: string): Promise<void> {
  await db.delete(soloGame).where(eq(soloGame.userId, userId));
}

/** Accounts with at least one finished Solo Game (a Ranked Account source for Rarity, FR-19). */
export async function soloPlayerIds(db: DbExecutor): Promise<string[]> {
  const rows = await db.selectDistinct({ userId: soloGame.userId }).from(soloGame).where(eq(soloGame.status, 'finished'));
  return rows.map((row) => row.userId);
}

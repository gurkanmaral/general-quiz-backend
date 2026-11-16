import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { DailyQuestion, LocalizedText } from '@general-quiz/contracts';
import type { DbExecutor } from '../../db/client';
import { anyChanged, excluded } from '../../db/upsert';
import { question, quiz } from './schema';

export type PublishedQuiz = {
  slug: string;
  title: LocalizedText;
  questions: readonly DailyQuestion[];
};

export type SyncCounts = { written: number; unpublished: number };
export type QuizzesSyncReport = { quizzes: SyncCounts; questions: SyncCounts };

type QuestionRow = typeof question.$inferSelect;

function toDailyQuestion(row: QuestionRow): DailyQuestion {
  return {
    slug: row.slug,
    category: row.category as DailyQuestion['category'],
    theme: row.theme as DailyQuestion['theme'],
    correctIndex: row.correctIndex,
    ...row.content,
  };
}

/** A published Question with its correct option, for the Daily (AD-4 exception). */
export async function getPublishedQuestion(db: DbExecutor, slug: string): Promise<DailyQuestion | undefined> {
  const [row] = await db
    .select()
    .from(question)
    .where(and(eq(question.slug, slug), eq(question.status, 'published')))
    .limit(1);
  return row ? toDailyQuestion(row) : undefined;
}

export async function publishedQuestionSlugs(db: DbExecutor): Promise<Set<string>> {
  const rows = await db.select({ slug: question.slug }).from(question).where(eq(question.status, 'published'));
  return new Set(rows.map((row) => row.slug));
}

/**
 * Upserts published quizzes and questions by slug; anything published in the database but absent
 * from `published` becomes `unpublished` (rows are never deleted: players may have answered them).
 */
export async function syncPublishedQuizzes(db: DbExecutor, published: readonly PublishedQuiz[]): Promise<QuizzesSyncReport> {
  const report: QuizzesSyncReport = { quizzes: { written: 0, unpublished: 0 }, questions: { written: 0, unpublished: 0 } };
  const now = sql`now()`;

  for (const item of published) {
    const written = await db
      .insert(quiz)
      .values({ slug: item.slug, status: 'published', title: item.title })
      .onConflictDoUpdate({
        target: quiz.slug,
        set: { status: excluded(quiz.status), title: excluded(quiz.title), updatedAt: now },
        setWhere: anyChanged([quiz.status, quiz.title]),
      })
      .returning({ slug: quiz.slug });
    report.quizzes.written += written.length;

    for (const [position, entry] of item.questions.entries()) {
      const { slug, category, theme, correctIndex, ...content } = entry;
      const rows = await db
        .insert(question)
        .values({ slug, quizSlug: item.slug, position, status: 'published', category, theme, correctIndex, content })
        .onConflictDoUpdate({
          target: question.slug,
          set: {
            quizSlug: excluded(question.quizSlug),
            position: excluded(question.position),
            status: excluded(question.status),
            category: excluded(question.category),
            theme: excluded(question.theme),
            correctIndex: excluded(question.correctIndex),
            content: excluded(question.content),
            updatedAt: now,
          },
          setWhere: anyChanged([
            question.quizSlug,
            question.position,
            question.status,
            question.category,
            question.theme,
            question.correctIndex,
            question.content,
          ]),
        })
        .returning({ slug: question.slug });
      report.questions.written += rows.length;
    }
  }

  const quizSlugs = published.map((item) => item.slug);
  const questionSlugs = published.flatMap((item) => item.questions.map((entry) => entry.slug));
  const withdrawnQuestions = await db
    .update(question)
    .set({ status: 'unpublished', updatedAt: now })
    .where(
      and(
        eq(question.status, 'published'),
        questionSlugs.length ? notInArray(question.slug, questionSlugs) : undefined,
      ),
    )
    .returning({ slug: question.slug });
  report.questions.unpublished = withdrawnQuestions.length;
  const withdrawnQuizzes = await db
    .update(quiz)
    .set({ status: 'unpublished', updatedAt: now })
    .where(and(eq(quiz.status, 'published'), quizSlugs.length ? notInArray(quiz.slug, quizSlugs) : undefined))
    .returning({ slug: quiz.slug });
  report.quizzes.unpublished = withdrawnQuizzes.length;
  return report;
}


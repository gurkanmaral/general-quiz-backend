import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { QUESTION_CATEGORIES, type DailyQuestion, type LocalizedText, type QuestionCategory, type QuestionDifficulty, type QuestionTheme, type QuizSummary } from '@general-quiz/contracts';
import type { DbExecutor } from '../../db/client';
import { anyChanged, excluded } from '../../db/upsert';
import { question, quiz } from './schema';

/** A published Question as imported: the Daily shape plus its Difficulty. */
export type PublishedQuestion = DailyQuestion & { difficulty: QuestionDifficulty };

export type PublishedQuiz = {
  slug: string;
  kind: 'quiz' | 'dailyPool';
  title: LocalizedText;
  description?: LocalizedText;
  category?: QuestionCategory;
  theme?: QuestionTheme;
  expertShare: number;
  questions: readonly PublishedQuestion[];
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
    const columns = [quiz.status, quiz.kind, quiz.title, quiz.description, quiz.category, quiz.theme, quiz.expertShare];
    const written = await db
      .insert(quiz)
      .values({
        slug: item.slug,
        status: 'published',
        kind: item.kind,
        title: item.title,
        description: item.description ?? null,
        category: item.category ?? null,
        theme: item.theme ?? null,
        expertShare: item.expertShare,
      })
      .onConflictDoUpdate({
        target: quiz.slug,
        set: {
          status: excluded(quiz.status),
          kind: excluded(quiz.kind),
          title: excluded(quiz.title),
          description: excluded(quiz.description),
          category: excluded(quiz.category),
          theme: excluded(quiz.theme),
          expertShare: excluded(quiz.expertShare),
          updatedAt: now,
        },
        setWhere: anyChanged(columns),
      })
      .returning({ slug: quiz.slug });
    report.quizzes.written += written.length;

    for (const [position, entry] of item.questions.entries()) {
      const { slug, category, theme, correctIndex, difficulty, ...content } = entry;
      const rows = await db
        .insert(question)
        .values({ slug, quizSlug: item.slug, position, status: 'published', difficulty, category, theme, correctIndex, content })
        .onConflictDoUpdate({
          target: question.slug,
          set: {
            quizSlug: excluded(question.quizSlug),
            position: excluded(question.position),
            status: excluded(question.status),
            difficulty: excluded(question.difficulty),
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
            question.difficulty,
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


export type ListedQuiz = Omit<QuizSummary, 'best' | 'record'>;

/** Published, listed Quizzes with their published Question counts (FR-13). Quizzes without Questions are hidden. */
export async function listPublishedQuizzes(db: DbExecutor): Promise<ListedQuiz[]> {
  const rows = await db
    .select({
      slug: quiz.slug,
      title: quiz.title,
      description: quiz.description,
      category: quiz.category,
      theme: quiz.theme,
      standardCount: sql<number>`count(*) filter (where ${question.difficulty} = 'standard')`.mapWith(Number),
      expertCount: sql<number>`count(*) filter (where ${question.difficulty} = 'expert')`.mapWith(Number),
    })
    .from(quiz)
    .innerJoin(question, and(eq(question.quizSlug, quiz.slug), eq(question.status, 'published')))
    .where(and(eq(quiz.status, 'published'), eq(quiz.kind, 'quiz')))
    .groupBy(quiz.slug);
  const order = new Map<string, number>(QUESTION_CATEGORIES.map((category, index) => [category, index]));
  return rows
    .filter((row) => row.category && row.theme && row.description)
    .map((row) => ({
      slug: row.slug,
      title: row.title,
      description: row.description!,
      category: row.category as QuestionCategory,
      theme: row.theme as QuestionTheme,
      questionCount: row.standardCount + row.expertCount,
      standardCount: row.standardCount,
      expertCount: row.expertCount,
    }))
    .sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) || a.title.en.localeCompare(b.title.en));
}

/** Published Questions per Quiz with their Difficulty: what Quiz Records and Unlock Rules count against. */
export async function publishedQuestionIndex(db: DbExecutor, quizSlugs?: readonly string[]): Promise<Map<string, Map<string, QuestionDifficulty>>> {
  const rows = await db
    .select({ quizSlug: question.quizSlug, slug: question.slug, difficulty: question.difficulty })
    .from(question)
    .where(and(eq(question.status, 'published'), quizSlugs ? inArray(question.quizSlug, [...quizSlugs]) : undefined));
  const index = new Map<string, Map<string, QuestionDifficulty>>();
  for (const row of rows) {
    const questions = index.get(row.quizSlug) ?? new Map<string, QuestionDifficulty>();
    questions.set(row.slug, row.difficulty);
    index.set(row.quizSlug, questions);
  }
  return index;
}

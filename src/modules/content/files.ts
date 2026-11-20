import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  DailyDateSchema,
  DailyQuestionSchema,
  LocalizedTextSchema,
  QuestionCategorySchema,
  QuestionDifficultySchema,
  QuestionFactSchema,
  QuestionThemeSchema,
} from '@general-quiz/contracts';

/** File formats under `content/` (AD-9). Not API payloads, so they live here, not in contracts. */
export const ContentStatusSchema = z.enum(['pending', 'published']);
const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case');

/**
 * `quiz`: listed on the Quizzes page (needs a Category, theme and description).
 * `dailyPool`: Questions that only feed the Daily schedule; never listed.
 */
export const QuizKindSchema = z.enum(['quiz', 'dailyPool']);
/** Share of Expert Questions in a Solo Game unless the quiz file sets `expertShare` (FR-14). */
export const DEFAULT_EXPERT_SHARE = 0.3;

/**
 * One Question: four Options, the correct one, a Difficulty, the story (`answerTitle` + `summary`),
 * facts and a Source link. Category and theme default to the quiz's.
 */
export const QuestionFileSchema = DailyQuestionSchema.extend({
  slug: SlugSchema,
  status: ContentStatusSchema,
  difficulty: QuestionDifficultySchema,
  category: QuestionCategorySchema.optional(),
  theme: QuestionThemeSchema.optional(),
  facts: z.array(QuestionFactSchema).min(1, 'add at least one fact'),
});
export type QuestionFile = z.infer<typeof QuestionFileSchema>;

export const QuizFileSchema = z
  .object({
    slug: SlugSchema,
    status: ContentStatusSchema,
    kind: QuizKindSchema.default('quiz'),
    title: LocalizedTextSchema,
    description: LocalizedTextSchema.optional(),
    category: QuestionCategorySchema.optional(),
    theme: QuestionThemeSchema.optional(),
    expertShare: z.number().min(0).max(1).default(DEFAULT_EXPERT_SHARE),
    questions: z.array(QuestionFileSchema),
  })
  .superRefine((file, ctx) => {
    if (file.kind === 'quiz') {
      for (const field of ['category', 'theme', 'description'] as const) {
        if (file[field] === undefined) ctx.addIssue({ code: 'custom', path: [field], message: `required for a listed quiz (kind "quiz")` });
      }
    }
    file.questions.forEach((question, index) => {
      for (const field of ['category', 'theme'] as const) {
        if (question[field] === undefined && file[field] === undefined) {
          ctx.addIssue({ code: 'custom', path: ['questions', index, field], message: `required when the quiz sets no ${field}` });
        }
      }
    });
  });
export type QuizFile = z.infer<typeof QuizFileSchema>;

export const ScheduleFileSchema = z.object({
  rotation: z.object({ anchor: DailyDateSchema, questions: z.array(SlugSchema) }),
  entries: z.array(z.object({ dailyDate: DailyDateSchema, question: SlugSchema, status: ContentStatusSchema })),
});
export type ScheduleFile = z.infer<typeof ScheduleFileSchema>;

export type ContentFiles = { quizzes: QuizFile[]; schedule: ScheduleFile };

/** `questions.3.source` plus the Question's slug when known, so reviewers find it fast. */
function describePath(raw: unknown, path: readonly PropertyKey[]): string {
  const text = path.map(String).join('.') || '(root)';
  if (path[0] !== 'questions' || typeof path[1] !== 'number') return text;
  const slug = (raw as { questions?: { slug?: unknown }[] })?.questions?.[path[1]]?.slug;
  return typeof slug === 'string' ? `${text} (question "${slug}")` : text;
}

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: cannot read JSON (${(error as Error).message})`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  ${describePath(raw, issue.path)}: ${issue.message}`).join('\n');
    throw new Error(`${path}: invalid content\n${issues}`);
  }
  return result.data;
}

/** Reads and validates `quizzes/*.json` and `daily/schedule.json` under `dir`. */
export async function readContentFiles(dir: string): Promise<ContentFiles> {
  const quizDir = join(dir, 'quizzes');
  const names = (await readdir(quizDir)).filter((name) => name.endsWith('.json')).sort();
  const quizzes = await Promise.all(
    names.map(async (name) => {
      const path = join(quizDir, name);
      const file = await readJson(path, QuizFileSchema);
      if (`${file.slug}.json` !== name) throw new Error(`${path}: invalid content\n  slug: must match the file name ("${name.slice(0, -5)}")`);
      return file;
    }),
  );
  const schedule = await readJson(join(dir, 'daily', 'schedule.json'), ScheduleFileSchema);
  return { quizzes, schedule };
}

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { DailyDateSchema, DailyQuestionSchema, LocalizedTextSchema } from '@general-quiz/contracts';

/** File formats under `content/` (AD-9). Not API payloads, so they live here, not in contracts. */
export const ContentStatusSchema = z.enum(['pending', 'published']);
const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case');

export const QuestionFileSchema = DailyQuestionSchema.extend({ slug: SlugSchema, status: ContentStatusSchema });
export const QuizFileSchema = z.object({
  slug: SlugSchema,
  status: ContentStatusSchema,
  title: LocalizedTextSchema,
  questions: z.array(QuestionFileSchema),
});
export type QuizFile = z.infer<typeof QuizFileSchema>;

export const ScheduleFileSchema = z.object({
  rotation: z.object({ anchor: DailyDateSchema, questions: z.array(SlugSchema) }),
  entries: z.array(z.object({ dailyDate: DailyDateSchema, question: SlugSchema, status: ContentStatusSchema })),
});
export type ScheduleFile = z.infer<typeof ScheduleFileSchema>;

export type ContentFiles = { quizzes: QuizFile[]; schedule: ScheduleFile };

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: cannot read JSON (${(error as Error).message})`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');
    throw new Error(`${path}: invalid content\n${issues}`);
  }
  return result.data;
}

/** Reads and validates `quizzes/*.json` and `daily/schedule.json` under `dir`. */
export async function readContentFiles(dir: string): Promise<ContentFiles> {
  const quizDir = join(dir, 'quizzes');
  const names = (await readdir(quizDir)).filter((name) => name.endsWith('.json')).sort();
  const quizzes = await Promise.all(names.map((name) => readJson(join(quizDir, name), QuizFileSchema)));
  const schedule = await readJson(join(dir, 'daily', 'schedule.json'), ScheduleFileSchema);
  return { quizzes, schedule };
}

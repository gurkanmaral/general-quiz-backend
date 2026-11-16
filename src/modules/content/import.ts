import type { Db } from '../../db/client';
import { syncSchedule, type ScheduleSyncReport } from '../daily';
import { publishedQuestionSlugs, syncPublishedQuizzes, type PublishedQuiz, type QuizzesSyncReport } from '../quizzes';
import { readContentFiles, type ContentFiles } from './files';

export type ImportReport = QuizzesSyncReport & ScheduleSyncReport & { skippedPending: number };

/** Published quizzes with only their published questions; pending items are skipped. */
export function publishedContent(files: ContentFiles): { quizzes: PublishedQuiz[]; skippedPending: number } {
  let skippedPending = 0;
  const quizzes: PublishedQuiz[] = [];
  const seen = new Set<string>();
  for (const file of files.quizzes) {
    if (seen.has(file.slug)) throw new Error(`Duplicate quiz slug "${file.slug}"`);
    seen.add(file.slug);
    if (file.status !== 'published') {
      skippedPending += 1 + file.questions.length;
      continue;
    }
    const questions = [];
    for (const { status, ...question } of file.questions) {
      if (status === 'published') questions.push(question);
      else skippedPending += 1;
    }
    quizzes.push({ slug: file.slug, title: file.title, questions });
  }
  const slugs = quizzes.flatMap((item) => item.questions.map((question) => question.slug));
  const duplicate = slugs.find((slug, index) => slugs.indexOf(slug) !== index);
  if (duplicate) throw new Error(`Duplicate question slug "${duplicate}"`);
  return { quizzes, skippedPending };
}

/**
 * `kno import`: upserts published content from files, in one transaction. Idempotent: a second
 * run with unchanged files writes nothing. Fails without writing if the schedule names a Question
 * that is not published.
 */
export async function importContent(db: Db, dir: string): Promise<ImportReport> {
  const files = await readContentFiles(dir);
  const { quizzes, skippedPending: skippedItems } = publishedContent(files);
  const allDates = files.schedule.entries.map((entry) => entry.dailyDate);
  const duplicateDate = allDates.find((date, index) => allDates.indexOf(date) !== index);
  if (duplicateDate) throw new Error(`daily/schedule.json: duplicate entry for ${duplicateDate}`);
  // Only published entries are kept; pending or removed ones are deleted from the schedule.
  const entries = files.schedule.entries.filter((entry) => entry.status === 'published');
  const skippedPending = skippedItems + files.schedule.entries.length - entries.length;

  return db.transaction(async (tx) => {
    const quizReport = await syncPublishedQuizzes(tx, quizzes);
    const published = await publishedQuestionSlugs(tx);
    const referenced = [...files.schedule.rotation.questions, ...entries.map((entry) => entry.question)];
    const missing = [...new Set(referenced.filter((slug) => !published.has(slug)))];
    if (missing.length) throw new Error(`Schedule references unpublished or unknown questions: ${missing.join(', ')}`);

    const scheduleReport = await syncSchedule(tx, {
      rotation: files.schedule.rotation,
      entries: entries.map((entry) => ({ dailyDate: entry.dailyDate, questionSlug: entry.question })),
    });
    return { ...quizReport, ...scheduleReport, skippedPending };
  });
}

export function countChanges(report: ImportReport): number {
  return (
    report.quizzes.written +
    report.quizzes.unpublished +
    report.questions.written +
    report.questions.unpublished +
    report.rotation.written +
    report.rotation.removed +
    report.entries.written +
    report.entries.removed
  );
}

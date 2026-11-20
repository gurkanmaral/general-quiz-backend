import type { Db } from '../../db/client';
import { syncSchedule, type ScheduleSyncReport } from '../daily';
import { publishedQuestionSlugs, syncPublishedQuizzes, type PublishedAward, type PublishedQuestion, type PublishedQuiz, type QuizzesSyncReport } from '../quizzes';
import { readContentFiles, type ContentFiles } from './files';

export type ImportReport = QuizzesSyncReport &
  ScheduleSyncReport & {
    /** Pending items left out, e.g. `question lotr-balrog (lord-of-the-rings)` (FR-36). */
    pending: string[];
    skippedPending: number;
  };

/** Published quizzes with only their published questions; pending items are skipped and listed. */
export function publishedContent(files: ContentFiles): { quizzes: PublishedQuiz[]; pending: string[] } {
  const pending: string[] = [];
  const quizzes: PublishedQuiz[] = [];
  const seen = new Set<string>();
  for (const file of files.quizzes) {
    if (seen.has(file.slug)) throw new Error(`Duplicate quiz slug "${file.slug}"`);
    seen.add(file.slug);
    if (file.status !== 'published') {
      pending.push(`quiz ${file.slug} (with its ${file.questions.length} questions)`);
      continue;
    }
    const questions: PublishedQuestion[] = [];
    for (const { status, ...question } of file.questions) {
      if (status !== 'published') {
        pending.push(`question ${question.slug} (${file.slug})`);
        continue;
      }
      // The file schema guarantees a Category and theme on the Question or the quiz.
      const category = question.category ?? file.category;
      const theme = question.theme ?? file.theme;
      if (!category || !theme) throw new Error(`Question "${question.slug}" has no category or theme`);
      questions.push({ ...question, category, theme });
    }
    const awards: PublishedAward[] = [];
    for (const [kind, list] of [['badge', file.badges], ['title', file.titles]] as const) {
      for (const { status, ...entry } of list) {
        if (status === 'published') awards.push({ ...entry, kind });
        else pending.push(`${kind} ${entry.slug} (${file.slug})`);
      }
    }
    quizzes.push({
      slug: file.slug,
      awards,
      kind: file.kind,
      title: file.title,
      description: file.description,
      category: file.category,
      theme: file.theme,
      expertShare: file.expertShare,
      questions,
    });
  }
  const slugs = quizzes.flatMap((item) => item.questions.map((question) => question.slug));
  const duplicate = slugs.find((slug, index) => slugs.indexOf(slug) !== index);
  if (duplicate) throw new Error(`Duplicate question slug "${duplicate}"`);
  const awardSlugs = files.quizzes.flatMap((file) => [...file.badges, ...file.titles].map((entry) => entry.slug));
  const duplicateAward = awardSlugs.find((slug, index) => awardSlugs.indexOf(slug) !== index);
  if (duplicateAward) throw new Error(`Duplicate badge/title slug "${duplicateAward}"`);
  return { quizzes, pending };
}

/**
 * `kno import`: upserts published content from files, in one transaction. Idempotent: a second
 * run with unchanged files writes nothing. Fails without writing if the schedule names a Question
 * that is not published.
 */
export async function importContent(db: Db, dir: string): Promise<ImportReport> {
  const files = await readContentFiles(dir);
  const { quizzes, pending } = publishedContent(files);
  const allDates = files.schedule.entries.map((entry) => entry.dailyDate);
  const duplicateDate = allDates.find((date, index) => allDates.indexOf(date) !== index);
  if (duplicateDate) throw new Error(`daily/schedule.json: duplicate entry for ${duplicateDate}`);
  // Only published entries are kept; pending or removed ones are deleted from the schedule.
  const entries = files.schedule.entries.filter((entry) => entry.status === 'published');
  for (const entry of files.schedule.entries) {
    if (entry.status !== 'published') pending.push(`daily ${entry.dailyDate} (${entry.question})`);
  }

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
    return { ...quizReport, ...scheduleReport, pending, skippedPending: pending.length };
  });
}

export function countChanges(report: ImportReport): number {
  return (
    report.quizzes.written +
    report.quizzes.unpublished +
    report.questions.written +
    report.questions.unpublished +
    report.awards.written +
    report.awards.unpublished +
    report.rotation.written +
    report.rotation.removed +
    report.entries.written +
    report.entries.removed
  );
}

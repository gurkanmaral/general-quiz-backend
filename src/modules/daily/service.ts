import { asc, eq, gte, notInArray, sql } from 'drizzle-orm';
import { isCalendarDate, type DailyQuestion, type DailyResponse } from '@general-quiz/contracts';
import { rotationSlug, type DailyRotation } from '@general-quiz/shared';
import type { DbExecutor } from '../../db/client';
import { anyChanged, excluded } from '../../db/upsert';
import { rotation, scheduleEntry } from './schema';

/** Supplied by the app factory (from the quizzes module) so `daily` does not import `quizzes`. */
export type QuestionLookup = (slug: string) => Promise<DailyQuestion | undefined>;

/** Largest real UTC offset (UTC+14, Line Islands); the smallest is UTC−12. */
const MAX_OFFSET_MS = 14 * 60 * 60 * 1000;

/** The latest date that is "today" somewhere on Earth at `now`. */
export function latestDailyDate(now: Date): string {
  return new Date(now.getTime() + MAX_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * AD-5 for reads: a real `YYYY-MM-DD` that is not after the latest "today on Earth".
 * Past dates are valid (the Library reads them); only future Dailies stay hidden.
 */
export function isAcceptableDailyDate(dailyDate: string, now: Date): boolean {
  return isCalendarDate(dailyDate) && dailyDate <= latestDailyDate(now);
}

async function readRotation(db: DbExecutor): Promise<DailyRotation | undefined> {
  const rows = await db.select().from(rotation).orderBy(asc(rotation.position));
  const first = rows[0];
  return first ? { anchor: first.anchor, questions: rows.map((row) => row.questionSlug) } : undefined;
}

/** Candidate slugs in priority order: the explicit schedule entry, then the rotation. */
export async function scheduledSlugs(db: DbExecutor, dailyDate: string): Promise<string[]> {
  const [entry] = await db.select().from(scheduleEntry).where(eq(scheduleEntry.dailyDate, dailyDate)).limit(1);
  const current = await readRotation(db);
  const fromRotation = current ? rotationSlug(current, dailyDate) : undefined;
  return [entry?.questionSlug, fromRotation].filter((slug): slug is string => Boolean(slug));
}

export function createDailyService(db: DbExecutor, lookupQuestion: QuestionLookup) {
  return {
    /** The Daily for a date; an entry whose Question is no longer published falls back to the rotation. */
    async getDaily(dailyDate: string): Promise<DailyResponse | undefined> {
      for (const slug of await scheduledSlugs(db, dailyDate)) {
        const question = await lookupQuestion(slug);
        if (question) return { dailyDate, question };
      }
      return undefined;
    },
  };
}
export type DailyService = ReturnType<typeof createDailyService>;

export type ScheduleInput = {
  rotation: DailyRotation;
  entries: readonly { dailyDate: string; questionSlug: string }[];
};
export type ScheduleSyncReport = { rotation: { written: number; removed: number }; entries: { written: number; removed: number } };

/**
 * Makes the stored schedule match `input` exactly: rotation upserted by position, entries by Daily
 * Date, and positions/entries absent from `input` deleted (schedule rows hold no answers).
 */
export async function syncSchedule(db: DbExecutor, input: ScheduleInput): Promise<ScheduleSyncReport> {
  const dates = input.entries.map((entry) => entry.dailyDate);
  const duplicate = dates.find((date, index) => dates.indexOf(date) !== index);
  if (duplicate) throw new Error(`Duplicate schedule entry for ${duplicate}`);
  const report: ScheduleSyncReport = { rotation: { written: 0, removed: 0 }, entries: { written: 0, removed: 0 } };
  const now = sql`now()`;
  for (const [position, questionSlug] of input.rotation.questions.entries()) {
    const rows = await db
      .insert(rotation)
      .values({ position, questionSlug, anchor: input.rotation.anchor })
      .onConflictDoUpdate({
        target: rotation.position,
        set: { questionSlug: excluded(rotation.questionSlug), anchor: excluded(rotation.anchor), updatedAt: now },
        setWhere: anyChanged([rotation.questionSlug, rotation.anchor]),
      })
      .returning({ position: rotation.position });
    report.rotation.written += rows.length;
  }
  const removed = await db
    .delete(rotation)
    .where(gte(rotation.position, input.rotation.questions.length))
    .returning({ position: rotation.position });
  report.rotation.removed = removed.length;

  for (const entry of input.entries) {
    const rows = await db
      .insert(scheduleEntry)
      .values(entry)
      .onConflictDoUpdate({
        target: scheduleEntry.dailyDate,
        set: { questionSlug: excluded(scheduleEntry.questionSlug), updatedAt: now },
        setWhere: anyChanged([scheduleEntry.questionSlug]),
      })
      .returning({ dailyDate: scheduleEntry.dailyDate });
    report.entries.written += rows.length;
  }
  const removedEntries = await db
    .delete(scheduleEntry)
    .where(dates.length ? notInArray(scheduleEntry.dailyDate, dates) : undefined)
    .returning({ dailyDate: scheduleEntry.dailyDate });
  report.entries.removed = removedEntries.length;
  return report;
}

import { asc, eq, gte, sql } from 'drizzle-orm';
import { isCalendarDate, type DailyQuestion, type DailyResponse } from '@general-quiz/contracts';
import { rotationSlug, type DailyRotation } from '@general-quiz/shared';
import type { DbExecutor } from '../../db/client';
import { anyChanged, excluded } from '../../db/upsert';
import { rotation, scheduleEntry } from './schema';

/** Supplied by the app factory (from the quizzes module) so `daily` does not import `quizzes`. */
export type QuestionLookup = (slug: string) => Promise<DailyQuestion | undefined>;

const MAX_OFFSET_MS = 14 * 60 * 60 * 1000;

function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** AD-5: a real `YYYY-MM-DD` that is the local date somewhere on Earth (UTC−14 h … UTC+14 h) at `now`. */
export function isAcceptableDailyDate(dailyDate: string, now: Date): boolean {
  if (!isCalendarDate(dailyDate)) return false;
  const earliest = utcDateKey(now.getTime() - MAX_OFFSET_MS);
  const latest = utcDateKey(now.getTime() + MAX_OFFSET_MS);
  return dailyDate >= earliest && dailyDate <= latest;
}

async function readRotation(db: DbExecutor): Promise<DailyRotation | undefined> {
  const rows = await db.select().from(rotation).orderBy(asc(rotation.position));
  const first = rows[0];
  return first ? { anchor: first.anchor, questions: rows.map((row) => row.questionSlug) } : undefined;
}

/** Explicit schedule entry first, then the rotation. */
export async function scheduledSlug(db: DbExecutor, dailyDate: string): Promise<string | undefined> {
  const [entry] = await db.select().from(scheduleEntry).where(eq(scheduleEntry.dailyDate, dailyDate)).limit(1);
  if (entry) return entry.questionSlug;
  const current = await readRotation(db);
  return current ? rotationSlug(current, dailyDate) : undefined;
}

export function createDailyService(db: DbExecutor, lookupQuestion: QuestionLookup) {
  return {
    /** The Daily for a date, or undefined when nothing published is scheduled. */
    async getDaily(dailyDate: string): Promise<DailyResponse | undefined> {
      const slug = await scheduledSlug(db, dailyDate);
      const question = slug ? await lookupQuestion(slug) : undefined;
      return question ? { dailyDate, question } : undefined;
    },
  };
}
export type DailyService = ReturnType<typeof createDailyService>;

export type ScheduleInput = {
  rotation: DailyRotation;
  entries: readonly { dailyDate: string; questionSlug: string }[];
};
export type ScheduleSyncReport = { rotation: { written: number; removed: number }; entries: { written: number } };

/**
 * Upserts the rotation by position and schedule entries by Daily Date. Rotation positions beyond the
 * new length are removed (they hold no answers); entries are never deleted.
 */
export async function syncSchedule(db: DbExecutor, input: ScheduleInput): Promise<ScheduleSyncReport> {
  const report: ScheduleSyncReport = { rotation: { written: 0, removed: 0 }, entries: { written: 0 } };
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
  return report;
}

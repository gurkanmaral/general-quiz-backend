import { asc, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import { isCalendarDate, type DailyPlay, type DailyQuestion, type DailyResponse, type Streak } from '@general-quiz/contracts';
import { computeStreak, daysBetween, rotationSlug, type DailyRotation } from '@general-quiz/shared';
import type { DbExecutor } from '../../db/client';
import { anyChanged, excluded } from '../../db/upsert';
import { answer, rotation, scheduleEntry } from './schema';

/** Supplied by the app factory (from the quizzes module) so `daily` does not import `quizzes`. */
export type QuestionLookup = (slug: string) => Promise<DailyQuestion | undefined>;

/** Largest real UTC offset (UTC+14, Line Islands); the smallest is UTC−12. */
const MAX_OFFSET_MS = 14 * 60 * 60 * 1000;
/** AD-5 accepts local dates for offsets UTC−14 … UTC+14 (a margin beyond the real UTC−12). */
const MIN_OFFSET_MS = -14 * 60 * 60 * 1000;

/** The latest date that is "today" somewhere on Earth at `now`. */
export function latestDailyDate(now: Date): string {
  return new Date(now.getTime() + MAX_OFFSET_MS).toISOString().slice(0, 10);
}

/** The earliest date that can still be "today" somewhere at `now` (AD-5). */
export function earliestDailyDate(now: Date): string {
  return new Date(now.getTime() + MIN_OFFSET_MS).toISOString().slice(0, 10);
}

/** AD-5 for a player's "today": a real date that is the local date for some UTC offset right now. */
export function isTodaySomewhere(date: string, now: Date): boolean {
  return isCalendarDate(date) && date >= earliestDailyDate(now) && date <= latestDailyDate(now);
}

/**
 * A Daily Date can be answered on `playedOn` when it is that day or any earlier day (the Library,
 * FR-7). Plays later than the repair window are stored but do not count for the Streak (FR-11).
 */
export function isAnswerable(dailyDate: string, playedOn: string): boolean {
  const late = daysBetween(dailyDate, playedOn);
  return Number.isFinite(late) && late >= 0;
}

type AnswerRow = typeof answer.$inferSelect;

function toPlay(row: AnswerRow): DailyPlay {
  return {
    dailyDate: row.dailyDate,
    questionSlug: row.questionSlug,
    selectedIndex: row.selectedIndex,
    correct: row.correct,
    answeredAt: row.answeredAt.toISOString(),
    playedOn: row.playedOn,
  };
}

function streakOf(plays: readonly DailyPlay[], today: string): Streak {
  return computeStreak(plays, today);
}

export type MergeResult = { plays: DailyPlay[]; streak: Streak; merged: number; skipped: number };

/** A local play the server can accept: real dates in order, nothing after "today" anywhere, nothing answered in the future. */
function isPlausible(play: DailyPlay, now: Date): boolean {
  const latest = latestDailyDate(now);
  const answeredAt = Date.parse(play.answeredAt);
  return (
    isCalendarDate(play.dailyDate) &&
    isCalendarDate(play.playedOn) &&
    play.dailyDate <= play.playedOn &&
    play.playedOn <= latest &&
    Number.isFinite(answeredAt) &&
    answeredAt <= now.getTime() + 60_000
  );
}

export type AnswerResult =
  | { ok: true; play: DailyPlay; correctIndex: number; streak: Streak }
  | { ok: false; reason: 'notScheduled' | 'alreadyAnswered' };

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

    /** Every answered Daily of a player (oldest first) and the Streak as of the player's `today`. */
    async getHistory(userId: string, today: string): Promise<{ plays: DailyPlay[]; streak: Streak }> {
      const rows = await db.select().from(answer).where(eq(answer.userId, userId)).orderBy(asc(answer.dailyDate));
      const plays = rows.map(toPlay);
      return { plays, streak: streakOf(plays, today) };
    },

    /**
     * Records a player's answer; the first answer per Daily Date is final (FR-8). Correctness is
     * decided here against the scheduled Question (AD-3). Callers validate dates first (AD-5).
     */
    async answer(userId: string, dailyDate: string, input: { selectedIndex: number; playedOn: string }, now: Date): Promise<AnswerResult> {
      const daily = await this.getDaily(dailyDate);
      if (!daily) return { ok: false, reason: 'notScheduled' };
      const inserted = await db
        .insert(answer)
        .values({
          userId,
          dailyDate,
          questionSlug: daily.question.slug,
          selectedIndex: input.selectedIndex,
          correct: input.selectedIndex === daily.question.correctIndex,
          answeredAt: now,
          playedOn: input.playedOn,
        })
        .onConflictDoNothing({ target: [answer.userId, answer.dailyDate] })
        .returning();
      const row = inserted[0];
      if (!row) return { ok: false, reason: 'alreadyAnswered' };
      const { streak } = await this.getHistory(userId, input.playedOn);
      return { ok: true, play: toPlay(row), correctIndex: daily.question.correctIndex, streak };
    },

    /**
     * Adds a browser's signed-out history (FR-3, AD-4): missing Daily Dates are added and on a
     * conflict the earliest `answeredAt` wins. Correctness is re-decided against the answered
     * Question when the server still has it; otherwise the local result is kept.
     */
    async merge(userId: string, today: string, plays: readonly DailyPlay[], now: Date): Promise<MergeResult> {
      const byDate = new Map<string, DailyPlay>();
      let skipped = 0;
      for (const play of plays) {
        if (!isPlausible(play, now)) {
          skipped += 1;
          continue;
        }
        const seen = byDate.get(play.dailyDate);
        if (!seen || Date.parse(play.answeredAt) < Date.parse(seen.answeredAt)) byDate.set(play.dailyDate, play);
      }
      const questions = new Map<string, DailyQuestion | undefined>();
      const rows = [];
      for (const play of byDate.values()) {
        if (!questions.has(play.questionSlug)) questions.set(play.questionSlug, await lookupQuestion(play.questionSlug));
        const question = questions.get(play.questionSlug);
        rows.push({
          userId,
          dailyDate: play.dailyDate,
          questionSlug: play.questionSlug,
          selectedIndex: play.selectedIndex,
          correct: question ? play.selectedIndex === question.correctIndex : play.correct,
          answeredAt: new Date(play.answeredAt),
          playedOn: play.playedOn,
        });
      }
      let merged = 0;
      if (rows.length) {
        const written = await db
          .insert(answer)
          .values(rows)
          .onConflictDoUpdate({
            target: [answer.userId, answer.dailyDate],
            set: {
              questionSlug: excluded(answer.questionSlug),
              selectedIndex: excluded(answer.selectedIndex),
              correct: excluded(answer.correct),
              answeredAt: excluded(answer.answeredAt),
              playedOn: excluded(answer.playedOn),
            },
            setWhere: sql`excluded.answered_at < ${answer.answeredAt}`,
          })
          .returning({ dailyDate: answer.dailyDate });
        merged = written.length;
      }
      const history = await this.getHistory(userId, today);
      return { ...history, merged, skipped };
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

/** What Friends may see of a player's Daily (FR-23): the Streak and whether `today` is played — never the answer. */
export type DailyStatus = { streak: Streak; played: boolean };

/** Daily status of several players as of the viewer's local `today` (AD-5). */
export async function dailyStatusOf(db: DbExecutor, userIds: readonly string[], today: string): Promise<Map<string, DailyStatus>> {
  const result = new Map<string, DailyStatus>();
  if (userIds.length === 0) return result;
  const rows = await db.select().from(answer).where(inArray(answer.userId, [...new Set(userIds)])).orderBy(asc(answer.dailyDate));
  const plays = new Map<string, DailyPlay[]>(userIds.map((id) => [id, []]));
  for (const row of rows) plays.get(row.userId)?.push(toPlay(row));
  for (const [id, list] of plays) result.set(id, { streak: streakOf(list, today), played: list.some((play) => play.dailyDate === today) });
  return result;
}

/** Removes every Daily answer of a player; runs inside the account-deletion transaction (FR-4). */
export async function deleteDailyUserData(db: DbExecutor, userId: string): Promise<void> {
  await db.delete(answer).where(eq(answer.userId, userId));
}

/** Accounts with at least one answered Daily (a Ranked Account source for Rarity, FR-19). */
export async function dailyPlayerIds(db: DbExecutor): Promise<string[]> {
  const rows = await db.selectDistinct({ userId: answer.userId }).from(answer);
  return rows.map((row) => row.userId);
}

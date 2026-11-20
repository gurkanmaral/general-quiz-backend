import { boolean, date, integer, pgSchema, primaryKey, smallint, text, timestamp } from 'drizzle-orm/pg-core';
import { accountsUserTable } from '../accounts';

export const knoDaily = pgSchema('kno_daily');

/** Repeating rotation; Question slugs reference `kno_quizzes.question` by id only (AD-2). */
export const rotation = knoDaily.table('rotation', {
  position: integer('position').primaryKey(),
  questionSlug: text('question_slug').notNull(),
  anchor: date('anchor', { mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Explicit Question for one Daily Date; overrides the rotation. */
export const scheduleEntry = knoDaily.table('schedule_entry', {
  dailyDate: date('daily_date', { mode: 'string' }).primaryKey(),
  questionSlug: text('question_slug').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A signed-in player's answer to one Daily Date (FR-8: one row per player and date, first answer
 * final). The only cross-module reference is the user id (AD-2); rows go with the account.
 */
export const answer = knoDaily.table(
  'answer',
  {
    userId: text('user_id')
      .notNull()
      .references(() => accountsUserTable.id, { onDelete: 'cascade' }),
    dailyDate: date('daily_date', { mode: 'string' }).notNull(),
    questionSlug: text('question_slug').notNull(),
    selectedIndex: smallint('selected_index').notNull(),
    correct: boolean('correct').notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull(),
    /** The player's local date when answering (AD-5); drives the 3-day repair rule. */
    playedOn: date('played_on', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.dailyDate] })],
);

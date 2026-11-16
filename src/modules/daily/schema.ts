import { date, integer, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

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

import { doublePrecision, index, integer, pgSchema, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { accountsUserTable } from '../accounts';

export const knoProgress = pgSchema('kno_progress');

/**
 * A player's Quiz Record (FR-15): games played (finished or abandoned with answers) and won.
 * Quizzes are referenced by slug only (AD-2).
 */
export const quizRecord = knoProgress.table(
  'quiz_record',
  {
    userId: text('user_id')
      .notNull()
      .references(() => accountsUserTable.id, { onDelete: 'cascade' }),
    quizSlug: text('quiz_slug').notNull(),
    gamesPlayed: integer('games_played').notNull().default(0),
    gamesWon: integer('games_won').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.quizSlug] })],
);

/** Every distinct Question a player has ever answered correctly (the heart of the Quiz Record). */
export const correctQuestion = knoProgress.table(
  'correct_question',
  {
    userId: text('user_id')
      .notNull()
      .references(() => accountsUserTable.id, { onDelete: 'cascade' }),
    quizSlug: text('quiz_slug').notNull(),
    questionSlug: text('question_slug').notNull(),
    firstCorrectAt: timestamp('first_correct_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.questionSlug] }), index('correct_question_quiz_idx').on(table.userId, table.quizSlug)],
);

/** Badges and Titles a player has earned (FR-16, FR-17). Granted once, never removed. */
export const userAward = knoProgress.table(
  'user_award',
  {
    userId: text('user_id')
      .notNull()
      .references(() => accountsUserTable.id, { onDelete: 'cascade' }),
    /** A Badge or Title slug from the quizzes module (by id only, AD-2). */
    awardSlug: text('award_slug').notNull(),
    quizSlug: text('quiz_slug').notNull(),
    earnedAt: timestamp('earned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.awardSlug] }), index('user_award_award_idx').on(table.awardSlug)],
);

/** Precomputed Rarity per Badge/Title (AD-11): share of Ranked Accounts holding it. Reads only read this. */
export const rarity = knoProgress.table('rarity', {
  awardSlug: text('award_slug').primaryKey(),
  holders: integer('holders').notNull(),
  rankedAccounts: integer('ranked_accounts').notNull(),
  percent: doublePrecision('percent').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
});

/** The one Title a player shows next to their name (FR-18); no row means none. */
export const equippedTitle = knoProgress.table('equipped_title', {
  userId: text('user_id')
    .primaryKey()
    .references(() => accountsUserTable.id, { onDelete: 'cascade' }),
  awardSlug: text('award_slug').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

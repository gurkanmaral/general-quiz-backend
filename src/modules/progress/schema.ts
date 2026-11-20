import { index, integer, pgSchema, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
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

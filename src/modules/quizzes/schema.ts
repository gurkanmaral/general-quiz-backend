import { boolean, doublePrecision, index, integer, jsonb, pgSchema, primaryKey, smallint, text, timestamp } from 'drizzle-orm/pg-core';
import { accountsUserTable } from '../accounts';
import type { DailyQuestion, LocalizedText, UnlockRule } from '@general-quiz/contracts';

export const knoQuizzes = pgSchema('kno_quizzes');

/** Imported content is `published`; items later withdrawn from the files become `unpublished` (never deleted). */
export const contentStatus = knoQuizzes.enum('content_status', ['published', 'unpublished']);
/** `quiz`: listed on the Quizzes page. `dailyPool`: Daily-only Questions. */
export const quizKind = knoQuizzes.enum('quiz_kind', ['quiz', 'dailyPool']);
export const questionDifficulty = knoQuizzes.enum('question_difficulty', ['standard', 'expert']);

/** Localized Question fields stored as one JSON document; everything players read. */
export type QuestionContent = Omit<DailyQuestion, 'slug' | 'category' | 'theme' | 'correctIndex'>;

export const quiz = knoQuizzes.table('quiz', {
  slug: text('slug').primaryKey(),
  status: contentStatus('status').notNull(),
  kind: quizKind('kind').notNull().default('quiz'),
  title: jsonb('title').$type<LocalizedText>().notNull(),
  description: jsonb('description').$type<LocalizedText>(),
  /** Null for a `dailyPool`, whose Questions carry their own Category. */
  category: text('category'),
  theme: text('theme'),
  /** Share of Expert Questions in a Solo Game (FR-14). */
  expertShare: doublePrecision('expert_share').notNull().default(0.3),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const question = knoQuizzes.table('question', {
  slug: text('slug').primaryKey(),
  quizSlug: text('quiz_slug')
    .notNull()
    .references(() => quiz.slug),
  position: integer('position').notNull(),
  status: contentStatus('status').notNull(),
  difficulty: questionDifficulty('difficulty').notNull().default('standard'),
  category: text('category').notNull(),
  theme: text('theme').notNull(),
  correctIndex: integer('correct_index').notNull(),
  content: jsonb('content').$type<QuestionContent>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const soloGameStatus = knoQuizzes.enum('solo_game_status', ['active', 'finished', 'abandoned']);

/**
 * A Solo Game (FR-14): the Questions drawn for it, in order, and its running score. A player has
 * at most one active game; starting another abandons it. Rows go with the account (AD-2).
 */
export const soloGame = knoQuizzes.table(
  'solo_game',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => accountsUserTable.id, { onDelete: 'cascade' }),
    quizSlug: text('quiz_slug')
      .notNull()
      .references(() => quiz.slug),
    questionSlugs: text('question_slugs').array().notNull(),
    status: soloGameStatus('status').notNull().default('active'),
    answered: smallint('answered').notNull().default(0),
    score: smallint('score').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** When the game was finished or abandoned. */
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [index('solo_game_user_idx').on(table.userId, table.status)],
);

/** One recorded answer in a Solo Game; the server decides correctness (AD-3). */
export const soloAnswer = knoQuizzes.table(
  'solo_answer',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => soloGame.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    questionSlug: text('question_slug').notNull(),
    selectedIndex: smallint('selected_index').notNull(),
    correct: boolean('correct').notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.position] })],
);

export const awardKind = knoQuizzes.enum('award_kind', ['badge', 'title']);

/**
 * Badge and Title definitions that come with a Quiz's content (FR-16, FR-17), each with a declarative
 * Unlock Rule (AD-10). Grants, evaluation and Rarity live in `progress`, which reads these through
 * this module's interface. Withdrawn awards become `unpublished`; grants are never removed.
 */
export const award = knoQuizzes.table('award', {
  slug: text('slug').primaryKey(),
  quizSlug: text('quiz_slug')
    .notNull()
    .references(() => quiz.slug),
  kind: awardKind('kind').notNull(),
  status: contentStatus('status').notNull(),
  position: integer('position').notNull(),
  name: jsonb('name').$type<LocalizedText>().notNull(),
  description: jsonb('description').$type<LocalizedText>().notNull(),
  icon: text('icon').notNull(),
  unlock: jsonb('unlock').$type<UnlockRule>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

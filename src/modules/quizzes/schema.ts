import { doublePrecision, integer, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import type { DailyQuestion, LocalizedText } from '@general-quiz/contracts';

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

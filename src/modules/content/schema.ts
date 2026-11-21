import { index, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import { accountsUserTable } from '../accounts';

export const knoContent = pgSchema('kno_content');

export const reportSource = knoContent.enum('report_source', ['daily', 'solo', 'lobby']);
export const reportStatus = knoContent.enum('report_status', ['open', 'resolved']);

/**
 * A player's report of a wrong Question (FR-38). The Question is referenced by slug only (AD-2);
 * reports go with the account (FR-4).
 */
export const report = knoContent.table(
  'report',
  {
    id: text('id').primaryKey(),
    questionSlug: text('question_slug').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => accountsUserTable.id, { onDelete: 'cascade' }),
    source: reportSource('source').notNull(),
    note: text('note'),
    status: reportStatus('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [index('report_status_idx').on(table.status, table.questionSlug)],
);

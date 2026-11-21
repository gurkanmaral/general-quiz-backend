import { index, integer, pgSchema, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { accountsUserTable } from '../accounts';

export const knoLobbies = pgSchema('kno_lobbies');

/** A finished Lobby Game (the actor itself lives in memory, AD-8). Quizzes by slug only (AD-2). */
export const lobbyGame = knoLobbies.table('lobby_game', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  quizSlug: text('quiz_slug').notNull(),
  questionCount: integer('question_count').notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
});

/** Each player's result in a finished Lobby Game: Ranked Accounts and Lobby co-players (FR-19, FR-20). */
export const lobbyGamePlayer = knoLobbies.table(
  'lobby_game_player',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => lobbyGame.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => accountsUserTable.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    correct: integer('correct').notNull(),
    rank: integer('rank').notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.userId] }), index('lobby_game_player_user_idx').on(table.userId)],
);

import { index, pgSchema, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { accountsUserTable } from '../accounts';

export const knoSocial = pgSchema('kno_social');

const userRef = (name: string) =>
  text(name)
    .notNull()
    .references(() => accountsUserTable.id, { onDelete: 'cascade' });

/**
 * A player's personal link token: the friend link `/f/<token>` and the Nudge Link `/n/<token>`
 * both name the player by it (FR-21, FR-25), so the Username never has to appear in a URL.
 */
export const playerLink = knoSocial.table('player_link', {
  userId: userRef('user_id').primaryKey(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A pending Friend Request (FR-21). Accepting or declining deletes it. */
export const friendRequest = knoSocial.table(
  'friend_request',
  {
    id: text('id').primaryKey(),
    fromUserId: userRef('from_user_id'),
    toUserId: userRef('to_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('friend_request_pair_uq').on(table.fromUserId, table.toUserId), index('friend_request_to_idx').on(table.toUserId)],
);

/** A mutual friendship, stored once per direction so each side reads its own rows (FR-21, FR-22). */
export const friendship = knoSocial.table(
  'friendship',
  {
    userId: userRef('user_id'),
    friendId: userRef('friend_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.friendId] })],
);

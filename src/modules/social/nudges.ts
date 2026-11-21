import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db, DbExecutor } from '../../db/client';
import { dailyStatusOf } from '../daily';
import { areFriends } from './friends';
import type { Notifications } from './notifications';
import { nudge, socialSettings } from './schema';

export type NudgeResult = { ok: true } | { ok: false; reason: 'notFriend' | 'alreadyPlayed' | 'alreadyNudged' | 'nudgesOff' };

export function createNudges(db: Db, notifications: Notifications, now: () => Date) {
  async function receivesNudges(userIds: readonly string[]): Promise<Map<string, boolean>> {
    const result = new Map(userIds.map((id) => [id, true]));
    if (userIds.length === 0) return result;
    const rows = await db.select().from(socialSettings).where(inArray(socialSettings.userId, [...userIds]));
    for (const row of rows) result.set(row.userId, row.receiveNudges);
    return result;
  }

  return {
    receivesNudges,

    /** Friends the sender already nudged for `dailyDate`. */
    async nudgedBy(senderId: string, dailyDate: string): Promise<Set<string>> {
      const rows = await db
        .select({ id: nudge.recipientId })
        .from(nudge)
        .where(and(eq(nudge.senderId, senderId), eq(nudge.dailyDate, dailyDate)));
      return new Set(rows.map((row) => row.id));
    },

    /**
     * Nudges a Friend who has not played `dailyDate` (the sender's local today, AD-5): at most once
     * per sender, Friend and date; refused when the Friend turned Nudges off (FR-24). The Friend
     * gets a notification with the sender and their own Streak.
     */
    async send(senderId: string, friendId: string, dailyDate: string): Promise<NudgeResult> {
      if (!(await areFriends(db, senderId, friendId))) return { ok: false, reason: 'notFriend' };
      const status = (await dailyStatusOf(db, [friendId], dailyDate)).get(friendId)!;
      if (status.played) return { ok: false, reason: 'alreadyPlayed' };
      if (!(await receivesNudges([friendId])).get(friendId)) return { ok: false, reason: 'nudgesOff' };
      const inserted = await db
        .insert(nudge)
        .values({ senderId, recipientId: friendId, dailyDate, createdAt: now() })
        .onConflictDoNothing()
        .returning({ senderId: nudge.senderId });
      if (inserted.length === 0) return { ok: false, reason: 'alreadyNudged' };
      await notifications.notify(friendId, 'nudge', senderId, { dailyDate, streak: status.streak.current });
      return { ok: true };
    },

    async settings(userId: string): Promise<{ receiveNudges: boolean }> {
      return { receiveNudges: (await receivesNudges([userId])).get(userId)! };
    },

    async updateSettings(userId: string, receiveNudges: boolean): Promise<{ receiveNudges: boolean }> {
      await db
        .insert(socialSettings)
        .values({ userId, receiveNudges, updatedAt: now() })
        .onConflictDoUpdate({ target: socialSettings.userId, set: { receiveNudges, updatedAt: now() } });
      return { receiveNudges };
    },
  };
}
export type Nudges = ReturnType<typeof createNudges>;

export async function deleteNudgesUserData(db: DbExecutor, userId: string): Promise<void> {
  await db.delete(nudge).where(or(eq(nudge.senderId, userId), eq(nudge.recipientId, userId)));
  await db.delete(socialSettings).where(eq(socialSettings.userId, userId));
}

import { EventEmitter } from 'node:events';
import { and, count, desc, eq, isNull, or } from 'drizzle-orm';
import { NotificationSchema, type Notification, type NotificationEvent, type NotificationKind, type NotificationsResponse } from '@general-quiz/contracts';
import type { Db, DbExecutor } from '../../db/client';
import { uuidv7 } from '../../db/ids';
import type { PlayerDirectory } from './friends';
import { notification } from './schema';

/** How many notifications the list shows. */
export const NOTIFICATION_LIST_SIZE = 50;

/** Extra fields per kind (everything but the common ones). */
export type NotificationData<K extends NotificationKind> = Omit<Extract<Notification, { kind: K }>, 'id' | 'actor' | 'createdAt' | 'read' | 'kind'>;

type Row = typeof notification.$inferSelect;

/**
 * Live delivery: the realtime layer listens for `notification` (userId, event) and `unread`
 * (userId, count) and pushes them to the player's sockets. Nothing is lost offline: the rows stay.
 */
export class NotificationBus extends EventEmitter<{ notification: [string, NotificationEvent]; unread: [string, number] }> {}

export function createNotifications(db: Db, directory: Pick<PlayerDirectory, 'findPlayers'>, now: () => Date) {
  const bus = new NotificationBus();

  async function unreadCount(userId: string): Promise<number> {
    const [row] = await db.select({ n: count() }).from(notification).where(and(eq(notification.userId, userId), isNull(notification.readAt)));
    return row?.n ?? 0;
  }

  async function toNotifications(rows: readonly Row[]): Promise<Notification[]> {
    const actors = await directory.findPlayers(rows.map((row) => row.actorId));
    return rows.flatMap((row) => {
      const actor = actors.get(row.actorId);
      if (!actor) return [];
      const parsed = NotificationSchema.safeParse({
        ...row.data,
        id: row.id,
        kind: row.kind,
        actor: { username: actor.username, avatar: actor.avatar },
        createdAt: row.createdAt.toISOString(),
        read: row.readAt !== null,
      });
      return parsed.success ? [parsed.data] : [];
    });
  }

  return {
    bus,
    unreadCount,

    /** Stores a notification and pushes it to the recipient if they are online (FR-26). */
    async notify<K extends NotificationKind>(userId: string, kind: K, actorId: string, data: NotificationData<K>): Promise<void> {
      const at = now();
      const [row] = await db
        .insert(notification)
        .values({ id: uuidv7(at.getTime()), userId, kind, actorId, data: data as Record<string, unknown>, createdAt: at })
        .returning();
      const [item] = await toNotifications([row!]);
      if (item) bus.emit('notification', userId, { notification: item, unread: await unreadCount(userId) });
    },

    async list(userId: string): Promise<NotificationsResponse> {
      const rows = await db
        .select()
        .from(notification)
        .where(eq(notification.userId, userId))
        .orderBy(desc(notification.createdAt), desc(notification.id))
        .limit(NOTIFICATION_LIST_SIZE);
      return { notifications: await toNotifications(rows), unread: await unreadCount(userId) };
    },

    /** Marks every notification read; the player's other devices get the new count. */
    async markAllRead(userId: string): Promise<void> {
      await db.update(notification).set({ readAt: now() }).where(and(eq(notification.userId, userId), isNull(notification.readAt)));
      bus.emit('unread', userId, 0);
    },
  };
}
export type Notifications = ReturnType<typeof createNotifications>;

export async function deleteNotificationsUserData(db: DbExecutor, userId: string): Promise<void> {
  await db.delete(notification).where(or(eq(notification.userId, userId), eq(notification.actorId, userId)));
}

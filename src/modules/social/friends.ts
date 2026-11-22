import { randomBytes } from 'node:crypto';
import { and, asc, eq, or } from 'drizzle-orm';
import type { EquippedTitle, Friend, FriendRequest, FriendsResponse, PlayerCard, SendFriendRequestBody } from '../../contracts';
import type { Db, DbExecutor } from '../../db/client';
import { uuidv7 } from '../../db/ids';
import type { PublicPlayer } from '../accounts';
import { dailyStatusOf } from '../daily';
import { friendRequest, friendship, playerLink } from './schema';

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TOKEN_LENGTH = 12;

/** A random, URL-safe link token without look-alike characters. */
export function newLinkToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  return Array.from(bytes, (byte) => TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length]).join('');
}

/** Lookups from other modules, plugged in by the app (AD-2: social reads only its own tables). */
export type PlayerDirectory = {
  /** From `accounts`: a player with a finished profile step. */
  findPlayer: (by: { id: string } | { username: string }) => Promise<PublicPlayer | undefined>;
  findPlayers: (ids: readonly string[]) => Promise<Map<string, PublicPlayer>>;
  /** From `progress`: equipped Titles (FR-18). */
  titlesOf: (ids: readonly string[]) => Promise<Map<string, EquippedTitle>>;
};

export type SendRequestResult =
  | { ok: true; status: 'requested'; player: PlayerCard; requestId: string; created: boolean }
  | { ok: true; status: 'friends'; player: PlayerCard }
  | { ok: false; reason: 'playerNotFound' | 'self' | 'alreadyFriends' | 'profileIncomplete' };

export async function areFriends(db: DbExecutor, userId: string, otherId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: friendship.userId })
    .from(friendship)
    .where(and(eq(friendship.userId, userId), eq(friendship.friendId, otherId)))
    .limit(1);
  return Boolean(row);
}

export async function friendIds(db: DbExecutor, userId: string): Promise<string[]> {
  const rows = await db.select({ id: friendship.friendId }).from(friendship).where(eq(friendship.userId, userId)).orderBy(asc(friendship.createdAt));
  return rows.map((row) => row.id);
}

async function befriend(tx: DbExecutor, a: string, b: string, at: Date): Promise<void> {
  await tx
    .insert(friendship)
    .values([
      { userId: a, friendId: b, createdAt: at },
      { userId: b, friendId: a, createdAt: at },
    ])
    .onConflictDoNothing();
  await tx
    .delete(friendRequest)
    .where(or(and(eq(friendRequest.fromUserId, a), eq(friendRequest.toUserId, b)), and(eq(friendRequest.fromUserId, b), eq(friendRequest.toUserId, a))));
}

/** Nudge state the Friends list shows (Story 4.4), supplied by the nudges service. */
export type NudgeView = {
  nudgedBy: (senderId: string, dailyDate: string) => Promise<Set<string>>;
  receivesNudges: (userIds: readonly string[]) => Promise<Map<string, boolean>>;
};

export function createFriends(db: Db, directory: PlayerDirectory, now: () => Date = () => new Date(), nudgeView?: NudgeView) {
  async function cards(ids: readonly string[]): Promise<Map<string, PlayerCard>> {
    const [players, titles] = await Promise.all([directory.findPlayers(ids), directory.titlesOf(ids)]);
    return new Map([...players.values()].map((player) => [player.id, { ...player, title: titles.get(player.id) ?? null }]));
  }

  async function linkToken(userId: string): Promise<string> {
    const [found] = await db.select().from(playerLink).where(eq(playerLink.userId, userId)).limit(1);
    if (found) return found.token;
    // Racing first visits keep whichever token was written first.
    await db.insert(playerLink).values({ userId, token: newLinkToken() }).onConflictDoNothing({ target: playerLink.userId });
    const [row] = await db.select().from(playerLink).where(eq(playerLink.userId, userId)).limit(1);
    return row!.token;
  }

  async function linkOwner(token: string): Promise<PublicPlayer | undefined> {
    const [row] = await db.select().from(playerLink).where(eq(playerLink.token, token)).limit(1);
    return row ? directory.findPlayer({ id: row.userId }) : undefined;
  }

  return {
    cards,
    linkToken,
    linkOwner,
    areFriends: (userId: string, otherId: string) => areFriends(db, userId, otherId),
    friendIds: (userId: string) => friendIds(db, userId),

    /**
     * Friends with their Daily status as of the viewer's `today` (FR-23), pending requests both
     * ways (newest first) and the friend-link token (FR-21).
     */
    async list(userId: string, today: string): Promise<FriendsResponse> {
      const [ids, requests, token] = await Promise.all([
        friendIds(db, userId),
        db
          .select()
          .from(friendRequest)
          .where(or(eq(friendRequest.fromUserId, userId), eq(friendRequest.toUserId, userId)))
          .orderBy(asc(friendRequest.createdAt)),
        linkToken(userId),
      ]);
      const other = (row: (typeof requests)[number]) => (row.fromUserId === userId ? row.toUserId : row.fromUserId);
      const [byId, status, nudged, receives] = await Promise.all([
        cards([...ids, ...requests.map(other)]),
        dailyStatusOf(db, ids, today),
        nudgeView ? nudgeView.nudgedBy(userId, today) : new Set<string>(),
        nudgeView ? nudgeView.receivesNudges(ids) : new Map<string, boolean>(),
      ]);
      const toRequest = (row: (typeof requests)[number]): FriendRequest[] => {
        const player = byId.get(other(row));
        return player ? [{ id: row.id, player, createdAt: row.createdAt.toISOString() }] : [];
      };
      return {
        friends: ids
          .flatMap((id): Friend[] => {
            const card = byId.get(id);
            const daily = status.get(id);
            if (!card) return [];
            const playedToday = daily?.played ?? false;
            const wasNudged = nudged.has(id);
            return [{ ...card, streak: daily?.streak.current ?? 0, playedToday, nudged: wasNudged, canNudge: !playedToday && !wasNudged && (receives.get(id) ?? false) }];
          })
          .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' })),
        incoming: requests.filter((row) => row.toUserId === userId).flatMap(toRequest).reverse(),
        outgoing: requests.filter((row) => row.fromUserId === userId).flatMap(toRequest).reverse(),
        linkToken: token,
      };
    },

    /**
     * Sends a Friend Request by Username or friend-link token (FR-21). Sending twice is harmless;
     * if the other player had already asked, this accepts their request instead.
     */
    async sendRequest(fromId: string, target: SendFriendRequestBody): Promise<SendRequestResult> {
      if (!(await directory.findPlayer({ id: fromId }))) return { ok: false, reason: 'profileIncomplete' };
      const found = 'username' in target ? await directory.findPlayer({ username: target.username }) : await linkOwner(target.token);
      if (!found) return { ok: false, reason: 'playerNotFound' };
      if (found.id === fromId) return { ok: false, reason: 'self' };
      const player = (await cards([found.id])).get(found.id)!;
      return db.transaction(async (tx) => {
        if (await areFriends(tx, fromId, found.id)) return { ok: false, reason: 'alreadyFriends' } as const;
        const [theirs] = await tx
          .select()
          .from(friendRequest)
          .where(and(eq(friendRequest.fromUserId, found.id), eq(friendRequest.toUserId, fromId)))
          .limit(1);
        if (theirs) {
          await befriend(tx, fromId, found.id, now());
          return { ok: true, status: 'friends', player } as const;
        }
        const at = now();
        const [created] = await tx
          .insert(friendRequest)
          .values({ id: uuidv7(at.getTime()), fromUserId: fromId, toUserId: found.id, createdAt: at })
          .onConflictDoNothing()
          .returning({ id: friendRequest.id });
        if (created) return { ok: true, status: 'requested', player, requestId: created.id, created: true } as const;
        const [existing] = await tx
          .select({ id: friendRequest.id })
          .from(friendRequest)
          .where(and(eq(friendRequest.fromUserId, fromId), eq(friendRequest.toUserId, found.id)))
          .limit(1);
        return { ok: true, status: 'requested', player, requestId: existing!.id, created: false } as const;
      });
    },

    /** Accepts a request sent to `userId`; returns the new Friend's id, or undefined if there is no such request. */
    async accept(userId: string, requestId: string): Promise<string | undefined> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(friendRequest)
          .where(and(eq(friendRequest.id, requestId), eq(friendRequest.toUserId, userId)))
          .for('update')
          .limit(1);
        if (!row) return undefined;
        await befriend(tx, userId, row.fromUserId, now());
        return row.fromUserId;
      });
    },

    /** Declines (recipient) or withdraws (sender) a request, silently. False if there is no such request. */
    async dismiss(userId: string, requestId: string): Promise<boolean> {
      const deleted = await db
        .delete(friendRequest)
        .where(and(eq(friendRequest.id, requestId), or(eq(friendRequest.toUserId, userId), eq(friendRequest.fromUserId, userId))))
        .returning({ id: friendRequest.id });
      return deleted.length > 0;
    },

    /** Ends a friendship from either side; the other player is not told (FR-22). */
    async remove(userId: string, friendId: string): Promise<void> {
      await db
        .delete(friendship)
        .where(or(and(eq(friendship.userId, userId), eq(friendship.friendId, friendId)), and(eq(friendship.userId, friendId), eq(friendship.friendId, userId))));
    },
  };
}
export type Friends = ReturnType<typeof createFriends>;

/** Account deletion (FR-4): friendships, requests and the link token of the player. */
export async function deleteFriendsUserData(db: DbExecutor, userId: string): Promise<void> {
  await db.delete(friendship).where(or(eq(friendship.userId, userId), eq(friendship.friendId, userId)));
  await db.delete(friendRequest).where(or(eq(friendRequest.fromUserId, userId), eq(friendRequest.toUserId, userId)));
  await db.delete(playerLink).where(eq(playerLink.userId, userId));
}

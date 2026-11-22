import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ACCOUNTS_PROBLEM_CODES, AvatarIdSchema, type AvatarId, type MeResponse, type ProfileUpdate } from '../../contracts';
import type { Db, DbExecutor } from '../../db/client';
import { problemResponse } from '../../http/problem';
import type { Auth } from './auth';
import { user, verification } from './schema';
import { isUsernameAllowed, normalizeUsername } from './usernames';

/** The signed-in player as other modules see it. */
export type SessionUser = { id: string; email: string };

/** What other players may see of an account: never the email. */
export type PublicPlayer = { id: string; username: string; avatar: AvatarId | null };

/**
 * Removes one player's rows from another module, inside the account-deletion transaction.
 * Every module that stores per-player rows registers one (FR-4).
 */
export type UserDataDeleter = (db: DbExecutor, userId: string) => Promise<void>;

export type ProfileResult =
  | { ok: true; me: MeResponse }
  | { ok: false; reason: 'usernameTaken' | 'usernameNotAllowed' };

type UserRow = typeof user.$inferSelect;

export function toMe(row: UserRow): MeResponse {
  const avatar = AvatarIdSchema.safeParse(row.avatar);
  const username = row.displayUsername ?? row.username ?? null;
  return {
    id: row.id,
    email: row.email,
    username,
    avatar: avatar.success ? avatar.data : null,
    profileComplete: Boolean(username && avatar.success),
  };
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return (error as { code?: string })?.code === '23505' || cause?.code === '23505';
}

export function createAccountsService(db: Db, auth: Auth, userDataDeleters: readonly UserDataDeleter[] = []) {
  async function sessionUser(headers: Headers): Promise<SessionUser | undefined> {
    const session = await auth.api.getSession({ headers });
    return session ? { id: session.user.id, email: session.user.email } : undefined;
  }

  return {
    sessionUser,

    /**
     * The signed-in player for a request (cookie or `Authorization: Bearer`), or a thrown 401
     * problem+json. The only way other modules get the user (AD-12).
     */
    async requireUser(c: Context): Promise<SessionUser> {
      const found = await sessionUser(c.req.raw.headers);
      if (found) return found;
      throw new HTTPException(401, {
        res: problemResponse(
          { status: 401, code: ACCOUNTS_PROBLEM_CODES.unauthorized, title: 'Sign in required', detail: 'This action needs a signed-in player.' },
          c.req.path,
        ),
      });
    },

    /** A player with a finished profile step, by id or by Username (case-insensitive). */
    async findPlayer(by: { id: string } | { username: string }): Promise<PublicPlayer | undefined> {
      const where = 'id' in by ? eq(user.id, by.id) : sql`lower(${user.username}) = ${normalizeUsername(by.username)}`;
      const [row] = await db.select().from(user).where(where).limit(1);
      const me = row ? toMe(row) : undefined;
      return me?.profileComplete && me.username ? { id: me.id, username: me.username, avatar: me.avatar } : undefined;
    },

    /** Players with a finished profile step among `ids` (others are left out). */
    async findPlayers(ids: readonly string[]): Promise<Map<string, PublicPlayer>> {
      const result = new Map<string, PublicPlayer>();
      if (ids.length === 0) return result;
      const rows = await db.select().from(user).where(inArray(user.id, [...new Set(ids)]));
      for (const row of rows) {
        const me = toMe(row);
        if (me.profileComplete && me.username) result.set(me.id, { id: me.id, username: me.username, avatar: me.avatar });
      }
      return result;
    },

    async getMe(userId: string): Promise<MeResponse | undefined> {
      const [row] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
      return row ? toMe(row) : undefined;
    },

    /**
     * Deletes the account (FR-4): every module's rows for the player, then the user, whose sessions
     * (cookie and bearer tokens) and sign-in accounts cascade, and pending verification tokens.
     * One transaction, so a failure leaves the account intact. The Username is free afterwards.
     */
    async deleteAccount(userId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
        if (!row) return false;
        for (const deleteUserData of userDataDeleters) await deleteUserData(tx, userId);
        await tx.delete(verification).where(eq(verification.identifier, row.email));
        await tx.delete(user).where(eq(user.id, userId));
        return true;
      });
    },

    /** Set-Cookie headers that clear the session cookies in the browser. */
    async clearSessionCookies(headers: Headers): Promise<Headers> {
      try {
        const result = await auth.api.signOut({ headers, returnHeaders: true });
        return result.headers;
      } catch {
        // Deleting the user removes every session anyway; the browser cookie just goes stale.
        return new Headers();
      }
    },

    /** Sets the Username (unique case-insensitively, blocklisted names refused) and the avatar. */
    async updateProfile(userId: string, profile: ProfileUpdate): Promise<ProfileResult> {
      if (!isUsernameAllowed(profile.username)) return { ok: false, reason: 'usernameNotAllowed' };
      const normalized = normalizeUsername(profile.username);
      const [taken] = await db
        .select({ id: user.id })
        .from(user)
        .where(and(sql`lower(${user.username}) = ${normalized}`, ne(user.id, userId)))
        .limit(1);
      if (taken) return { ok: false, reason: 'usernameTaken' };
      try {
        const [row] = await db
          .update(user)
          .set({ username: normalized, displayUsername: profile.username.trim(), avatar: profile.avatar, updatedAt: new Date() })
          .where(eq(user.id, userId))
          .returning();
        if (!row) throw new Error('Signed-in user row is missing');
        return { ok: true, me: toMe(row) };
      } catch (error) {
        // Two players racing for one name: the unique index decides.
        if (isUniqueViolation(error)) return { ok: false, reason: 'usernameTaken' };
        throw error;
      }
    },
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;

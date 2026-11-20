import { and, eq, ne, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ACCOUNTS_PROBLEM_CODES, AvatarIdSchema, type MeResponse, type ProfileUpdate } from '@general-quiz/contracts';
import type { Db } from '../../db/client';
import { problemResponse } from '../../http/problem';
import type { Auth } from './auth';
import { user } from './schema';
import { isUsernameAllowed, normalizeUsername } from './usernames';

/** The signed-in player as other modules see it. */
export type SessionUser = { id: string; email: string };

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

export function createAccountsService(db: Db, auth: Auth) {
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

    async getMe(userId: string): Promise<MeResponse | undefined> {
      const [row] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
      return row ? toMe(row) : undefined;
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

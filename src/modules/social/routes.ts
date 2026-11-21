import { Hono, type Context } from 'hono';
import {
  FriendsQuerySchema,
  LinkTokenSchema,
  SOCIAL_PROBLEM_CODES,
  SendFriendRequestBodySchema,
  type FriendsResponse,
  type LinkOwnerResponse,
  type NotificationsResponse,
  type SendFriendRequestResponse,
} from '@general-quiz/contracts';
import { problem } from '../../http/problem';
import type { Social } from './service';

export type SocialRouteDeps = {
  social: Social;
  requireUser: (c: Context) => Promise<{ id: string }>;
  /** True when `date` is a valid local "today" somewhere (AD-5, from `daily`). */
  isToday: (date: string) => boolean;
};

const REASONS = {
  playerNotFound: { status: 404, code: SOCIAL_PROBLEM_CODES.playerNotFound, title: 'Player not found' },
  self: { status: 422, code: SOCIAL_PROBLEM_CODES.self, title: "That's you", detail: "You can't send a Friend Request to yourself." },
  alreadyFriends: { status: 409, code: SOCIAL_PROBLEM_CODES.alreadyFriends, title: 'Already Friends' },
  profileIncomplete: { status: 409, code: SOCIAL_PROBLEM_CODES.profileIncomplete, title: 'Finish your profile first' },
} as const;

const requestNotFound = (c: Context) => problem(c, { status: 404, code: SOCIAL_PROBLEM_CODES.requestNotFound, title: 'Friend Request not found' });

/** `/api/v1/friends`: the Friends list, Friend Requests and removing a Friend (FR-21, FR-22). */
export function friendsRoutes({ social, requireUser, isToday }: SocialRouteDeps) {
  return new Hono()
    .get('/', async (c) => {
      const user = await requireUser(c);
      const query = FriendsQuerySchema.safeParse(c.req.query());
      if (!query.success || !isToday(query.data.today)) {
        return problem(c, { status: 400, code: SOCIAL_PROBLEM_CODES.invalidToday, title: 'Invalid local date', detail: 'today must be your local date as YYYY-MM-DD.' });
      }
      return c.json((await social.friendsList(user.id, query.data.today)) satisfies FriendsResponse);
    })
    .post('/requests', async (c) => {
      const user = await requireUser(c);
      const body = SendFriendRequestBodySchema.safeParse(await c.req.json().catch(() => undefined));
      if (!body.success) {
        return problem(c, {
          status: 400,
          code: SOCIAL_PROBLEM_CODES.invalidRequest,
          title: 'Invalid Friend Request',
          detail: 'Send { "username": "<name>" } or { "token": "<friend link token>" }.',
        });
      }
      const result = await social.sendFriendRequest(user.id, body.data);
      if (!result.ok) return problem(c, REASONS[result.reason]);
      return c.json({ status: result.status, player: result.player } satisfies SendFriendRequestResponse, result.status === 'friends' ? 200 : 201);
    })
    .post('/requests/:id/accept', async (c) => {
      const user = await requireUser(c);
      const friendId = await social.acceptFriendRequest(user.id, c.req.param('id'));
      return friendId ? c.body(null, 204) : requestNotFound(c);
    })
    .delete('/requests/:id', async (c) => {
      const user = await requireUser(c);
      return (await social.friends.dismiss(user.id, c.req.param('id'))) ? c.body(null, 204) : requestNotFound(c);
    })
    .delete('/:userId', async (c) => {
      const user = await requireUser(c);
      // Silent and idempotent: removing someone who is not a Friend changes nothing (FR-22).
      await social.friends.remove(user.id, c.req.param('userId'));
      return c.body(null, 204);
    });
}

/** `/api/v1/links/{token}` (public): who a friend link or Nudge Link belongs to (FR-21, FR-25). */
export function linkRoutes({ social }: Pick<SocialRouteDeps, 'social'>) {
  return new Hono().get('/:token', async (c) => {
    const token = LinkTokenSchema.safeParse(c.req.param('token'));
    const owner = token.success ? await social.friends.linkOwner(token.data) : undefined;
    if (!owner) return problem(c, { status: 404, code: SOCIAL_PROBLEM_CODES.linkNotFound, title: 'Link not found' });
    return c.json({ player: { username: owner.username, avatar: owner.avatar } } satisfies LinkOwnerResponse);
  });
}

/** `/api/v1/notifications`: the in-app list with its unread count; opening it marks all read (FR-26). */
export function notificationRoutes({ social, requireUser }: Omit<SocialRouteDeps, 'isToday'>) {
  return new Hono()
    .get('/', async (c) => {
      const user = await requireUser(c);
      return c.json((await social.notifications.list(user.id)) satisfies NotificationsResponse);
    })
    .post('/read', async (c) => {
      const user = await requireUser(c);
      await social.notifications.markAllRead(user.id);
      return c.json({ unread: 0 as const });
    });
}

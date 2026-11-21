import { Hono, type Context } from 'hono';
import { CreateLobbyBodySchema, LOBBY_PROBLEM_CODES, LobbyCodeSchema, LobbyInviteBodySchema, SOCIAL_PROBLEM_CODES, type CreateLobbyResponse } from '@general-quiz/contracts';
import type { RateLimit } from '../../http/rateLimit';
import { problem } from '../../http/problem';
import type { LobbyHub } from './hub';

export type LobbyRouteDeps = {
  hub: LobbyHub;
  requireUser: (c: Context) => Promise<{ id: string }>;
  /** From `social` via the app: notifies a Friend of a Lobby Invite; false when not Friends (FR-29). */
  /** Per-account rate limit (Story 6.3). */
  rateLimit: RateLimit;
  invite: (fromId: string, toId: string, lobby: { code: string; quizTitle: { en: string; tr?: string } }) => Promise<boolean>;
};

const notFound = (c: Context) => problem(c, { status: 404, code: LOBBY_PROBLEM_CODES.notFound, title: 'Lobby not found' });

/** `/api/v1/lobbies`: create a Lobby (FR-27) and invite Friends to it (FR-29). Play happens over `/lobby` sockets. */
export function lobbyRoutes({ hub, requireUser, invite, rateLimit }: LobbyRouteDeps) {
  return new Hono()
    .post('/', async (c) => {
      const user = await requireUser(c);
      rateLimit(c, user.id, 'lobbyCreate');
      const body = CreateLobbyBodySchema.safeParse(await c.req.json().catch(() => undefined));
      if (!body.success) return problem(c, { status: 400, code: LOBBY_PROBLEM_CODES.invalid, title: 'Invalid Lobby', detail: 'Send { "quizSlug": "<quiz>" }.' });
      const result = await hub.create(user.id, body.data.quizSlug);
      if (!result.ok) {
        return result.reason === 'quizNotFound'
          ? problem(c, { status: 404, code: LOBBY_PROBLEM_CODES.quizNotFound, title: 'Quiz not found' })
          : problem(c, { status: 409, code: LOBBY_PROBLEM_CODES.profileIncomplete, title: 'Finish your profile first' });
      }
      return c.json({ code: result.code } satisfies CreateLobbyResponse, 201);
    })
    .post('/:code/invites', async (c) => {
      const user = await requireUser(c);
      const code = LobbyCodeSchema.safeParse(c.req.param('code'));
      const lobby = code.success ? hub.get(code.data) : undefined;
      if (!lobby) return notFound(c);
      if (!lobby.has(user.id)) return problem(c, { status: 403, code: LOBBY_PROBLEM_CODES.notInLobby, title: 'Join the Lobby first' });
      const body = LobbyInviteBodySchema.safeParse(await c.req.json().catch(() => undefined));
      if (!body.success) return problem(c, { status: 400, code: LOBBY_PROBLEM_CODES.invalid, title: 'Invalid invite', detail: 'Send { "userId": "<friend id>" }.' });
      const sent = await invite(user.id, body.data.userId, { code: lobby.code, quizTitle: lobby.quiz.title });
      if (!sent) return problem(c, { status: 404, code: SOCIAL_PROBLEM_CODES.notFriend, title: 'Not your Friend' });
      return c.body(null, 204);
    });
}

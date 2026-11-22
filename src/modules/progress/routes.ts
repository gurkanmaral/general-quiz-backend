import { Hono, type Context } from 'hono';
import {
  EquipTitleBodySchema,
  PROGRESS_PROBLEM_CODES,
  ProfileQuerySchema,
  type EquipTitleResponse,
  type ProfileResponse,
  type Streak,
} from '../../contracts';
import type { DbExecutor } from '../../db/client';
import { problem } from '../../http/problem';
import type { PublicPlayer } from '../accounts';
import { equipTitle, getEquippedTitle, profileAwards } from './profile';

export type ProfileRouteDeps = {
  db: DbExecutor;
  requireUser: (c: Context) => Promise<{ id: string }>;
  /** From `accounts` (AD-12): the public part of an account. */
  findPlayer: (by: { id: string } | { username: string }) => Promise<PublicPlayer | undefined>;
  /** From `daily`: the Streak as of the viewer's local `today`, or undefined when `today` is invalid (AD-5). */
  streakOf: (userId: string, today: string) => Promise<Streak | undefined>;
  /**
   * Whether `viewerId` may see `playerId`'s Profile: Friends and Lobby co-players only (FR-20).
   * TODO(Epic 4/5): the social and lobbies modules supply this; until then nobody else qualifies.
   */
  canViewProfile?: (viewerId: string, playerId: string) => Promise<boolean>;
};

const invalidToday = (c: Context) =>
  problem(c, { status: 400, code: PROGRESS_PROBLEM_CODES.invalidToday, title: 'Invalid local date', detail: 'today must be your local date as YYYY-MM-DD.' });

async function buildProfile(deps: ProfileRouteDeps, player: PublicPlayer, today: string, own: boolean): Promise<ProfileResponse | undefined> {
  const streak = await deps.streakOf(player.id, today);
  if (!streak) return undefined;
  const [title, quizzes] = await Promise.all([getEquippedTitle(deps.db, player.id), profileAwards(deps.db, player.id, own)]);
  return { username: player.username, avatar: player.avatar, title, streak, own, quizzes };
}

/** `/api/v1/profile`: the signed-in player's own Profile and equipped Title (FR-18, FR-20). */
export function profileRoutes(deps: ProfileRouteDeps) {
  return new Hono()
    .get('/', async (c) => {
      const user = await deps.requireUser(c);
      const query = ProfileQuerySchema.safeParse(c.req.query());
      if (!query.success) return invalidToday(c);
      const player = await deps.findPlayer({ id: user.id });
      if (!player) return problem(c, { status: 404, code: PROGRESS_PROBLEM_CODES.playerNotFound, title: 'Finish your profile first' });
      const profile = await buildProfile(deps, player, query.data.today, true);
      return profile ? c.json(profile satisfies ProfileResponse) : invalidToday(c);
    })
    .get('/title', async (c) => {
      const user = await deps.requireUser(c);
      return c.json({ title: await getEquippedTitle(deps.db, user.id) } satisfies EquipTitleResponse);
    })
    .put('/title', async (c) => {
      const user = await deps.requireUser(c);
      const body = EquipTitleBodySchema.safeParse(await c.req.json().catch(() => undefined));
      if (!body.success) {
        return problem(c, { status: 400, code: PROGRESS_PROBLEM_CODES.invalidTitle, title: 'Invalid Title', detail: 'Send { "title": "<slug>" } or { "title": null }.' });
      }
      const result = await equipTitle(deps.db, user.id, body.data.title);
      if (!result.ok) {
        return problem(c, { status: 422, code: PROGRESS_PROBLEM_CODES.titleNotEarned, title: 'Title not earned', detail: 'You can only equip a Title you have unlocked.' });
      }
      return c.json({ title: result.title } satisfies EquipTitleResponse);
    });
}

/** `/api/v1/players/{username}`: another player's Profile, without unearned items (FR-20). */
export function playerRoutes(deps: ProfileRouteDeps) {
  return new Hono().get('/:username', async (c) => {
    const viewer = await deps.requireUser(c);
    const query = ProfileQuerySchema.safeParse(c.req.query());
    if (!query.success) return invalidToday(c);
    const player = await deps.findPlayer({ username: c.req.param('username') });
    if (!player) return problem(c, { status: 404, code: PROGRESS_PROBLEM_CODES.playerNotFound, title: 'Player not found' });
    const own = player.id === viewer.id;
    if (!own && !(await deps.canViewProfile?.(viewer.id, player.id))) {
      return problem(c, {
        status: 403,
        code: PROGRESS_PROBLEM_CODES.profileForbidden,
        title: 'Profile not visible',
        detail: 'Profiles are visible to Friends and Lobby co-players only.',
      });
    }
    // Viewing yourself here shows what others would see (earned items only).
    const profile = await buildProfile(deps, player, query.data.today, false);
    return profile ? c.json(profile satisfies ProfileResponse) : invalidToday(c);
  });
}

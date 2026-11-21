import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FriendsResponseSchema, LinkOwnerResponseSchema, MeResponseSchema, ProblemSchema, SendFriendRequestResponseSchema } from '@general-quiz/contracts';
import { friendRequest, friendship, playerLink } from '../src/db/schema';
import { importContent } from '../src/modules/content';
import { openTestDatabase } from './db';
import { completeProfile, createSignedInUser, createTestApp, jsonRequest } from './auth';

const database = openTestDatabase();
const db = database.db;
const clock = new Date('2026-11-16T12:00:00Z');
const { app, mailer } = createTestApp(db, { now: () => clock });
const CONTENT_DIR = new URL('../../../content', import.meta.url).pathname;
let ada = '';
let bob = '';
let cyd = '';
let newbie = '';
const ids: Record<string, string> = {};

beforeAll(async () => {
  await importContent(db, CONTENT_DIR);
  ada = await createSignedInUser(app, mailer, 'ada@example.com');
  bob = await createSignedInUser(app, mailer, 'bob@example.com');
  cyd = await createSignedInUser(app, mailer, 'cyd@example.com');
  newbie = await createSignedInUser(app, mailer, 'new@example.com');
  for (const [cookie, name] of [[ada, 'Ada'], [bob, 'Bob'], [cyd, 'Cyd']] as const) {
    expect((await completeProfile(app, cookie, name)).status).toBe(200);
    ids[name] = MeResponseSchema.parse(await (await app.request('/api/v1/me', jsonRequest('GET', undefined, cookie))).json()).id;
  }
});
afterAll(() => database.close());

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(ProblemSchema.parse(await res.json()).code).toBe(code);
}
const send = (cookie: string, body: unknown) => app.request('/api/v1/friends/requests', jsonRequest('POST', body, cookie));
async function list(cookie: string) {
  const res = await app.request('/api/v1/friends?today=2026-11-16', jsonRequest('GET', undefined, cookie));
  expect(res.status).toBe(200);
  return FriendsResponseSchema.parse(await res.json());
}

describe('Friend Requests (Story 4.1, FR-21)', () => {
  it('needs a signed-in player with a finished profile', async () => {
    await expectProblem(await app.request('/api/v1/friends?today=2026-11-16'), 401, 'accounts.unauthorized');
    await expectProblem(await send('', { username: 'bob' }), 401, 'accounts.unauthorized');
    await expectProblem(await send(newbie, { username: 'bob' }), 409, 'social.profileIncomplete');
  });

  it('refuses bad bodies, unknown players and yourself', async () => {
    await expectProblem(await send(ada, {}), 400, 'social.invalidRequest');
    await expectProblem(await send(ada, { username: 'x' }), 400, 'social.invalidRequest');
    await expectProblem(await send(ada, { username: 'nobody' }), 404, 'social.playerNotFound');
    await expectProblem(await send(ada, { token: 'ZZZZZZZZZZZZ' }), 404, 'social.playerNotFound');
    await expectProblem(await send(ada, { username: 'ADA' }), 422, 'social.self');
  });

  it('sends by Username; the recipient sees it and nothing is mutual until accepted', async () => {
    const res = await send(ada, { username: 'BOB' });
    expect(res.status).toBe(201);
    expect(SendFriendRequestResponseSchema.parse(await res.json())).toMatchObject({ status: 'requested', player: { username: 'Bob', id: ids.Bob } });
    expect((await send(ada, { username: 'bob' })).status).toBe(201); // idempotent
    expect(await db.select().from(friendRequest)).toHaveLength(1);
    const bobs = await list(bob);
    expect(bobs.incoming.map((item) => item.player.username)).toEqual(['Ada']);
    expect(bobs.friends).toEqual([]);
    expect((await list(ada)).outgoing.map((item) => item.player.username)).toEqual(['Bob']);
    expect(JSON.stringify(bobs)).not.toMatch(/@example\.com/);
  });

  it('only the recipient can accept; accepting makes a mutual friendship', async () => {
    const id = (await list(bob)).incoming[0]!.id;
    await expectProblem(await app.request(`/api/v1/friends/requests/${id}/accept`, jsonRequest('POST', undefined, ada)), 404, 'social.requestNotFound');
    await expectProblem(await app.request(`/api/v1/friends/requests/${id}/accept`, jsonRequest('POST', undefined, cyd)), 404, 'social.requestNotFound');
    expect((await app.request(`/api/v1/friends/requests/${id}/accept`, jsonRequest('POST', undefined, bob))).status).toBe(204);
    expect((await list(ada)).friends.map((item) => item.username)).toEqual(['Bob']);
    expect((await list(bob)).friends.map((item) => item.username)).toEqual(['Ada']);
    expect((await list(bob)).incoming).toEqual([]);
    await expectProblem(await send(bob, { username: 'ada' }), 409, 'social.alreadyFriends');
  });

  it('sends by friend link; the link names its owner publicly; declining is silent', async () => {
    const token = (await list(cyd)).linkToken;
    expect((await list(cyd)).linkToken).toBe(token);
    const owner = await app.request(`/api/v1/links/${token}`);
    expect(LinkOwnerResponseSchema.parse(await owner.json())).toEqual({ player: { username: 'Cyd', avatar: 'owl' } });
    await expectProblem(await app.request('/api/v1/links/nope'), 404, 'social.linkNotFound');
    expect((await send(ada, { token })).status).toBe(201);
    const id = (await list(cyd)).incoming[0]!.id;
    expect((await app.request(`/api/v1/friends/requests/${id}`, jsonRequest('DELETE', undefined, cyd))).status).toBe(204);
    expect((await list(ada)).outgoing).toEqual([]);
    expect((await list(ada)).friends.map((item) => item.username)).toEqual(['Bob']);
    await expectProblem(await app.request(`/api/v1/friends/requests/${id}`, jsonRequest('DELETE', undefined, cyd)), 404, 'social.requestNotFound');
  });

  it('a request back to someone who already asked you accepts theirs', async () => {
    expect((await send(cyd, { username: 'bob' })).status).toBe(201);
    const res = await send(bob, { username: 'cyd' });
    expect(res.status).toBe(200);
    expect(SendFriendRequestResponseSchema.parse(await res.json()).status).toBe('friends');
    expect((await list(cyd)).friends.map((item) => item.username)).toEqual(['Bob']);
    expect((await list(cyd)).outgoing).toEqual([]);
  });
});

describe('Friends list with Daily status (Story 4.3, FR-23)', () => {
  const answer = (cookie: string, date: string, selectedIndex = 1) =>
    app.request(`/api/v1/daily/${date}/answer`, jsonRequest('POST', { selectedIndex, playedOn: '2026-11-16' }, cookie));

  it("needs the viewer's local today", async () => {
    await expectProblem(await app.request('/api/v1/friends', jsonRequest('GET', undefined, ada)), 400, 'social.invalidToday');
    await expectProblem(await app.request('/api/v1/friends?today=2026-11-10', jsonRequest('GET', undefined, ada)), 400, 'social.invalidToday');
  });

  it('shows avatar, equipped Title, Streak and played / not yet — never the answer', async () => {
    // Ada and Bob are Friends; Bob has a 2-day streak and played today, Cyd (Bob's Friend) has not.
    expect((await answer(bob, '2026-11-15')).status).toBe(200);
    expect((await answer(bob, '2026-11-16', 2)).status).toBe(200);
    const [bobRow] = (await list(ada)).friends;
    expect(bobRow).toEqual({ id: ids.Bob, username: 'Bob', avatar: 'owl', title: null, streak: 2, playedToday: true });
    const bobs = await list(bob);
    expect(bobs.friends.map((item) => [item.username, item.streak, item.playedToday])).toEqual([
      ['Ada', 0, false],
      ['Cyd', 0, false],
    ]);
    const raw = JSON.stringify(await list(ada));
    expect(raw).not.toMatch(/selectedIndex|correct|questionSlug/);
  });

  it("uses the viewer's today: yesterday's play is not today's", async () => {
    clock.setTime(Date.parse('2026-11-17T12:00:00Z'));
    const res = await app.request('/api/v1/friends?today=2026-11-17', jsonRequest('GET', undefined, ada));
    const [bobRow] = FriendsResponseSchema.parse(await res.json()).friends;
    expect(bobRow).toMatchObject({ streak: 2, playedToday: false });
    clock.setTime(Date.parse('2026-11-16T12:00:00Z'));
  });
});

describe('removing a Friend (FR-22)', () => {
  it('either side removes silently, for both', async () => {
    expect((await app.request(`/api/v1/friends/${ids.Ada}`, jsonRequest('DELETE', undefined, bob))).status).toBe(204);
    expect((await list(ada)).friends).toEqual([]);
    expect((await list(bob)).friends.map((item) => item.username)).toEqual(['Cyd']);
    expect((await app.request(`/api/v1/players/bob?today=2026-11-16`, jsonRequest('GET', undefined, ada))).status).toBe(403);
    expect((await app.request(`/api/v1/friends/${ids.Ada}`, jsonRequest('DELETE', undefined, bob))).status).toBe(204);
  });

  it('account deletion removes the player from every list', async () => {
    expect((await app.request('/api/v1/me', jsonRequest('DELETE', { confirm: 'DELETE' }, cyd))).status).toBe(204);
    expect((await list(bob)).friends).toEqual([]);
    const rows = [...(await db.select().from(friendship)), ...(await db.select().from(playerLink))];
    expect(rows.some((row) => row.userId === ids.Cyd || ('friendId' in row && row.friendId === ids.Cyd))).toBe(false);
  });
});

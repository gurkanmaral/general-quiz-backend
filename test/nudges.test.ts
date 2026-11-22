import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FriendsResponseSchema, LinkOwnerResponseSchema, MeResponseSchema, NotificationsResponseSchema, ProblemSchema, SocialSettingsSchema } from '@general-quiz/contracts';
import { importContent } from '../src/modules/content';
import { openTestDatabase } from './db';
import { completeProfile, createSignedInUser, createTestApp, jsonRequest, signUp, confirmLastMail } from './auth';

const database = openTestDatabase();
const db = database.db;
const clock = new Date('2026-11-16T12:00:00Z');
const { app, mailer } = createTestApp(db, { now: () => clock });
const CONTENT_DIR = new URL('../content', import.meta.url).pathname;
let ada = '';
let bob = '';
let cyd = '';
const ids: Record<string, string> = {};
const TODAY = '2026-11-16';

beforeAll(async () => {
  await importContent(db, CONTENT_DIR);
  ada = await createSignedInUser(app, mailer, 'ada@example.com');
  bob = await createSignedInUser(app, mailer, 'bob@example.com');
  cyd = await createSignedInUser(app, mailer, 'cyd@example.com');
  for (const [cookie, name] of [[ada, 'Ada'], [bob, 'Bob'], [cyd, 'Cyd']] as const) {
    expect((await completeProfile(app, cookie, name)).status).toBe(200);
    ids[name] = MeResponseSchema.parse(await (await app.request('/api/v1/me', jsonRequest('GET', undefined, cookie))).json()).id;
  }
  // Ada–Bob and Ada–Cyd are Friends.
  for (const other of ['bob', 'cyd']) expect((await app.request('/api/v1/friends/requests', jsonRequest('POST', { username: other }, ada))).status).toBe(201);
  expect((await app.request('/api/v1/friends/requests', jsonRequest('POST', { username: 'ada' }, bob))).status).toBe(200);
  expect((await app.request('/api/v1/friends/requests', jsonRequest('POST', { username: 'ada' }, cyd))).status).toBe(200);
  expect((await app.request('/api/v1/notifications/read', jsonRequest('POST', undefined, bob))).status).toBe(200);
  // Bob has a 1-day streak from yesterday.
  expect((await app.request('/api/v1/daily/2026-11-15/answer', jsonRequest('POST', { selectedIndex: 0, playedOn: '2026-11-15' }, bob))).status).toBe(200);
});
afterAll(() => database.close());

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(ProblemSchema.parse(await res.json()).code).toBe(code);
}
const nudge = (cookie: string, userId: string, dailyDate = TODAY) => app.request(`/api/v1/friends/${userId}/nudge`, jsonRequest('POST', { dailyDate }, cookie));
const friendsOf = async (cookie: string) => FriendsResponseSchema.parse(await (await app.request(`/api/v1/friends?today=${TODAY}`, jsonRequest('GET', undefined, cookie))).json()).friends;
const notificationsOf = async (cookie: string) => NotificationsResponseSchema.parse(await (await app.request('/api/v1/notifications', jsonRequest('GET', undefined, cookie))).json());

describe('Nudge (Story 4.4, FR-24)', () => {
  it('needs a signed-in Friend and a valid local date', async () => {
    await expectProblem(await nudge('', ids.Bob!), 401, 'accounts.unauthorized');
    await expectProblem(await nudge(bob, ids.Cyd!), 404, 'social.notFriend');
    await expectProblem(await nudge(ada, ids.Bob!, '2026-11-01'), 400, 'social.invalidToday');
    await expectProblem(await app.request(`/api/v1/friends/${ids.Bob}/nudge`, jsonRequest('POST', {}, ada)), 400, 'social.invalidToday');
  });

  it('notifies the Friend with the sender and their Streak, once per day', async () => {
    expect((await friendsOf(ada)).find((item) => item.username === 'Bob')).toMatchObject({ playedToday: false, canNudge: true, nudged: false });
    expect((await nudge(ada, ids.Bob!)).status).toBe(204);
    const { notifications, unread } = await notificationsOf(bob);
    expect(unread).toBe(1);
    expect(notifications[0]).toMatchObject({ kind: 'nudge', actor: { username: 'Ada' }, dailyDate: TODAY, streak: 1 });
    await expectProblem(await nudge(ada, ids.Bob!), 409, 'social.alreadyNudged');
    expect((await notificationsOf(bob)).notifications.filter((item) => item.kind === 'nudge')).toHaveLength(1);
    expect((await friendsOf(ada)).find((item) => item.username === 'Bob')).toMatchObject({ canNudge: false, nudged: true });
    // A Friend can still nudge back.
    expect((await nudge(bob, ids.Ada!)).status).toBe(204);
  });

  it('is unavailable once the Friend has played today', async () => {
    expect((await app.request(`/api/v1/daily/${TODAY}/answer`, jsonRequest('POST', { selectedIndex: 0, playedOn: TODAY }, cyd))).status).toBe(200);
    expect((await friendsOf(ada)).find((item) => item.username === 'Cyd')).toMatchObject({ playedToday: true, canNudge: false });
    await expectProblem(await nudge(ada, ids.Cyd!), 409, 'social.alreadyPlayed');
  });

  it('a new day allows a new Nudge', async () => {
    clock.setTime(Date.parse('2026-11-17T12:00:00Z'));
    expect((await nudge(ada, ids.Bob!, '2026-11-17')).status).toBe(204);
    clock.setTime(Date.parse('2026-11-16T12:00:00Z'));
  });
});

describe('turning Nudges off (FR-24)', () => {
  it('reads and updates the setting', async () => {
    expect(SocialSettingsSchema.parse(await (await app.request('/api/v1/social/settings', jsonRequest('GET', undefined, ada))).json())).toEqual({ receiveNudges: true });
    await expectProblem(await app.request('/api/v1/social/settings', jsonRequest('PUT', { receiveNudges: 'no' }, ada)), 400, 'social.invalidSettings');
    await expectProblem(await app.request('/api/v1/social/settings', jsonRequest('PUT', { receiveNudges: false })), 401, 'accounts.unauthorized');
    const res = await app.request('/api/v1/social/settings', jsonRequest('PUT', { receiveNudges: false }, ada));
    expect(await res.json()).toEqual({ receiveNudges: false });
  });

  it('hides Nudge and refuses Nudges to a player who turned them off', async () => {
    expect((await friendsOf(cyd)).find((item) => item.username === 'Ada')).toMatchObject({ playedToday: false, canNudge: false, nudged: false });
    await expectProblem(await nudge(cyd, ids.Ada!), 409, 'social.nudgesOff');
    expect((await app.request('/api/v1/social/settings', jsonRequest('PUT', { receiveNudges: true }, ada))).status).toBe(200);
    expect((await nudge(cyd, ids.Ada!)).status).toBe(204);
  });
});

describe('Nudge Link (FR-25)', () => {
  it('names the sender to anyone, and tells a signed-in Friend they are connected', async () => {
    const token = FriendsResponseSchema.parse(await (await app.request(`/api/v1/friends?today=${TODAY}`, jsonRequest('GET', undefined, ada))).json()).linkToken;
    const anonymous = LinkOwnerResponseSchema.parse(await (await app.request(`/api/v1/links/${token}`)).json());
    expect(anonymous).toEqual({ player: { username: 'Ada', avatar: 'owl' }, connected: false });
    expect(LinkOwnerResponseSchema.parse(await (await app.request(`/api/v1/links/${token}`, jsonRequest('GET', undefined, bob))).json()).connected).toBe(true);
    expect(LinkOwnerResponseSchema.parse(await (await app.request(`/api/v1/links/${token}`, jsonRequest('GET', undefined, ada))).json()).connected).toBe(true);

    // Someone who signs up from the link can send Ada a Friend Request with its token.
    expect((await signUp(app, 'dan@example.com')).status).toBe(200);
    const dan = await confirmLastMail(app, mailer);
    expect((await completeProfile(app, dan, 'Dan')).status).toBe(200);
    expect(LinkOwnerResponseSchema.parse(await (await app.request(`/api/v1/links/${token}`, jsonRequest('GET', undefined, dan))).json()).connected).toBe(false);
    expect((await app.request('/api/v1/friends/requests', jsonRequest('POST', { token }, dan))).status).toBe(201);
    expect((await notificationsOf(ada)).notifications[0]).toMatchObject({ kind: 'friendRequest', actor: { username: 'Dan' } });
  });
});

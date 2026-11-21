import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EquipTitleResponseSchema,
  MeResponseSchema,
  ProblemSchema,
  ProfileResponseSchema,
  SoloGameResponseSchema,
} from '@general-quiz/contracts';
import { equippedTitle, question } from '../src/db/schema';
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

beforeAll(async () => {
  await importContent(db, CONTENT_DIR);
  ada = await createSignedInUser(app, mailer, 'ada@example.com');
  bob = await createSignedInUser(app, mailer, 'bob@example.com');
  expect((await completeProfile(app, ada, 'Ada', 'fox')).status).toBe(200);
  expect((await completeProfile(app, bob, 'Bob')).status).toBe(200);
});
afterAll(() => database.close());

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(ProblemSchema.parse(await res.json()).code).toBe(code);
}

async function profile(cookie: string) {
  const res = await app.request('/api/v1/profile?today=2026-11-16', jsonRequest('GET', undefined, cookie));
  expect(res.status).toBe(200);
  return ProfileResponseSchema.parse(await res.json());
}

function equip(cookie: string, title: unknown) {
  return app.request('/api/v1/profile/title', jsonRequest('PUT', { title }, cookie));
}

async function me(cookie: string) {
  return MeResponseSchema.parse(await (await app.request('/api/v1/me', jsonRequest('GET', undefined, cookie))).json());
}

async function playPerfect(cookie: string, slug: string) {
  const game = SoloGameResponseSchema.parse(await (await app.request(`/api/v1/quizzes/${slug}/games`, jsonRequest('POST', undefined, cookie))).json());
  const rows = await db.select().from(question).where(inArray(question.slug, game.questions.map((item) => item.slug)));
  const right = new Map(rows.map((row) => [row.slug, row.correctIndex]));
  for (const item of game.questions) {
    await app.request(`/api/v1/solo-games/${game.gameId}/answers`, jsonRequest('POST', { position: item.position, selectedIndex: right.get(item.slug) }, cookie));
  }
}

describe('own Profile (Story 3.3)', () => {
  it('requires a signed-in player and a valid local date', async () => {
    await expectProblem(await app.request('/api/v1/profile?today=2026-11-16'), 401, 'accounts.unauthorized');
    await expectProblem(await app.request('/api/v1/profile', jsonRequest('GET', undefined, ada)), 400, 'progress.invalidToday');
    await expectProblem(await app.request('/api/v1/profile?today=2026-11-10', jsonRequest('GET', undefined, ada)), 400, 'progress.invalidToday');
    await expectProblem(await equip('', 'lotr-frodo'), 401, 'accounts.unauthorized');
  });

  it('shows name, avatar, Streak, and every Badge and Title greyed with how to earn it', async () => {
    expect((await app.request('/api/v1/daily/2026-11-16/answer', jsonRequest('POST', { selectedIndex: 0, playedOn: '2026-11-16' }, ada))).status).toBe(200);
    const body = await profile(ada);
    expect(body).toMatchObject({ username: 'Ada', avatar: 'fox', title: null, own: true, streak: { current: 1, best: 1 } });
    expect(body.quizzes.map((item) => item.title.en)).toEqual(['The Lord of the Rings', 'The Solar System']);
    const lotr = body.quizzes[0]!.awards;
    expect(lotr.map((item) => [item.kind, item.slug, item.earned])).toEqual([
      ['badge', 'lotr-middle-earth-fan', false],
      ['title', 'lotr-gandalf', false],
      ['title', 'lotr-frodo', false],
    ]);
    expect(lotr[1]!.howToEarn).toBe('Answer every Expert question of this quiz correctly at least once.');
    expect(lotr[0]!.rarity).toEqual({ percent: null, label: 'New' });
  });

  it('shows earned items in colour with Rarity, keeping the how-to-earn for the rest', async () => {
    await playPerfect(ada, 'lord-of-the-rings');
    await app.progress.computeRarity();
    const frodo = (await profile(ada)).quizzes[0]!.awards.find((item) => item.slug === 'lotr-frodo')!;
    expect(frodo).toMatchObject({ earned: true, howToEarn: null, rarity: { label: '100%' } });
    expect(frodo.earnedAt).toBe('2026-11-16T12:00:00.000Z');
  });
});

describe('equipped Title (Story 3.3, FR-18)', () => {
  it('equips an earned Title and shows it with the name in /me and on the Profile', async () => {
    const res = await equip(ada, 'lotr-frodo');
    expect(res.status).toBe(200);
    expect(EquipTitleResponseSchema.parse(await res.json()).title).toEqual({ slug: 'lotr-frodo', name: { en: 'Frodo' }, icon: '💍' });
    expect((await me(ada)).title).toEqual({ slug: 'lotr-frodo', name: { en: 'Frodo' }, icon: '💍' });
    expect((await profile(ada)).title?.slug).toBe('lotr-frodo');
    expect(EquipTitleResponseSchema.parse(await (await app.request('/api/v1/profile/title', jsonRequest('GET', undefined, ada))).json()).title?.slug).toBe('lotr-frodo');
  });

  it('refuses Badges, unearned Titles and unknown slugs', async () => {
    await expectProblem(await equip(ada, 'lotr-middle-earth-fan'), 422, 'progress.titleNotEarned');
    await expectProblem(await equip(ada, 'lotr-gandalf'), 422, 'progress.titleNotEarned');
    await expectProblem(await equip(ada, 'nope'), 422, 'progress.titleNotEarned');
    await expectProblem(await equip(bob, 'lotr-frodo'), 422, 'progress.titleNotEarned');
    await expectProblem(await app.request('/api/v1/profile/title', jsonRequest('PUT', { title: 3 }, ada)), 400, 'progress.invalidTitle');
    expect((await me(ada)).title?.slug).toBe('lotr-frodo');
  });

  it('equips none with null', async () => {
    expect(EquipTitleResponseSchema.parse(await (await equip(ada, null)).json()).title).toBeNull();
    expect((await me(ada)).title).toBeNull();
    expect((await equip(ada, 'lotr-frodo')).status).toBe(200);
  });
});

describe("another player's Profile (FR-20)", () => {
  it('is refused to strangers and shown to Friends', async () => {
    await expectProblem(await app.request('/api/v1/players/ada?today=2026-11-16', jsonRequest('GET', undefined, bob)), 403, 'progress.profileForbidden');
    expect((await app.request('/api/v1/friends/requests', jsonRequest('POST', { username: 'ada' }, bob))).status).toBe(201);
    await expectProblem(await app.request('/api/v1/players/ada?today=2026-11-16', jsonRequest('GET', undefined, bob)), 403, 'progress.profileForbidden');
    expect((await app.request('/api/v1/friends/requests', jsonRequest('POST', { username: 'bob' }, ada))).status).toBe(200);
    const res = await app.request('/api/v1/players/ada?today=2026-11-16', jsonRequest('GET', undefined, bob));
    expect(res.status).toBe(200);
    expect(ProfileResponseSchema.parse(await res.json())).toMatchObject({ username: 'Ada', own: false });
    const bobId = (await me(bob)).id;
    expect((await app.request(`/api/v1/friends/${bobId}`, jsonRequest('DELETE', undefined, ada))).status).toBe(204);
    await expectProblem(await app.request('/api/v1/players/ada?today=2026-11-16', jsonRequest('GET', undefined, bob)), 403, 'progress.profileForbidden');
    await expectProblem(await app.request('/api/v1/players/ada?today=2026-11-16'), 401, 'accounts.unauthorized');
    await expectProblem(await app.request('/api/v1/players/nobody?today=2026-11-16', jsonRequest('GET', undefined, bob)), 404, 'progress.playerNotFound');
  });

  it('shows what others would see — earned items only — when it is your own', async () => {
    const res = await app.request('/api/v1/players/ADA?today=2026-11-16', jsonRequest('GET', undefined, ada));
    expect(res.status).toBe(200);
    const body = ProfileResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ username: 'Ada', own: false, title: { slug: 'lotr-frodo' } });
    expect(body.quizzes.flatMap((item) => item.awards.map((entry) => entry.slug))).toEqual(['lotr-frodo']);
    expect(body.quizzes[0]!.awards[0]!.howToEarn).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/ada@example\.com/);
  });

  it('removes the equipped Title with the account', async () => {
    const id = (await me(ada)).id;
    expect((await app.request('/api/v1/me', jsonRequest('DELETE', { confirm: 'DELETE' }, ada))).status).toBe(204);
    expect(await db.select().from(equippedTitle).where(eq(equippedTitle.userId, id))).toEqual([]);
  });
});

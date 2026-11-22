import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MeResponseSchema, ProblemSchema } from '@general-quiz/contracts';
import { importContent } from '../src/modules/content';
import { createRateLimiter } from '../src/http/rateLimit';
import { openTestDatabase } from './db';
import { completeProfile, createSignedInUser, createTestApp, jsonRequest, ORIGIN, PASSWORD } from './auth';

const database = openTestDatabase();
const db = database.db;
let clock = new Date('2026-11-16T12:00:00Z');
const { app, mailer } = createTestApp(db, { now: () => clock });
const CONTENT_DIR = new URL('../content', import.meta.url).pathname;
let ada = '';
let bobId = '';

beforeAll(async () => {
  await importContent(db, CONTENT_DIR);
  ada = await createSignedInUser(app, mailer, 'ada@example.com');
  const bob = await createSignedInUser(app, mailer, 'bob@example.com');
  expect((await completeProfile(app, ada, 'Ada')).status).toBe(200);
  expect((await completeProfile(app, bob, 'Bob')).status).toBe(200);
  bobId = MeResponseSchema.parse(await (await app.request('/api/v1/me', jsonRequest('GET', undefined, bob))).json()).id;
});
afterAll(() => database.close());

async function expectRateLimited(res: Response) {
  expect(res.status).toBe(429);
  expect(res.headers.get('content-type')).toBe('application/problem+json');
  expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(ProblemSchema.parse(await res.json()).code).toBe('rateLimited');
}

describe('rate limits (Story 6.3)', () => {
  it('counts per key in fixed windows', () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const limiter = createRateLimiter(() => now);
    const rule = { limit: 2, windowMs: 60_000 };
    expect([limiter.hit('a', rule), limiter.hit('a', rule), limiter.hit('b', rule)]).toEqual([0, 0, 0]);
    expect(limiter.hit('a', rule)).toBe(60);
    now = new Date('2026-01-01T00:00:45Z');
    expect(limiter.hit('a', rule)).toBe(15);
    now = new Date('2026-01-01T00:01:00Z');
    expect(limiter.hit('a', rule)).toBe(0);
  });

  it('limits Friend Requests to 20 an hour per player', async () => {
    // Unknown usernames still count: the limit is on sending, not on success.
    for (let i = 0; i < 20; i += 1) expect((await app.request('/api/v1/friends/requests', jsonRequest('POST', { username: `nobody${i}` }, ada))).status).toBe(404);
    await expectRateLimited(await app.request('/api/v1/friends/requests', jsonRequest('POST', { username: 'bob' }, ada)));
  });

  it('limits Nudges to 30 an hour per player', async () => {
    for (let i = 0; i < 30; i += 1) expect((await app.request(`/api/v1/friends/${bobId}/nudge`, jsonRequest('POST', { dailyDate: '2026-11-16' }, ada))).status).toBe(404);
    await expectRateLimited(await app.request(`/api/v1/friends/${bobId}/nudge`, jsonRequest('POST', { dailyDate: '2026-11-16' }, ada)));
  });

  it('limits Lobby creation to 10 an hour per player', async () => {
    clock = new Date('2026-11-16T15:00:00Z');
    for (let i = 0; i < 10; i += 1) expect((await app.request('/api/v1/lobbies', jsonRequest('POST', { quizSlug: 'no-such-quiz' }, ada))).status).toBe(404);
    await expectRateLimited(await app.request('/api/v1/lobbies', jsonRequest('POST', { quizSlug: 'solar-system' }, ada)));
    clock = new Date('2026-11-16T16:00:00Z');
    expect((await app.request('/api/v1/lobbies', jsonRequest('POST', { quizSlug: 'solar-system' }, ada))).status).toBe(201);
  });

  it('answers auth limits (Better Auth, by client IP) with problem+json rateLimited', async () => {
    const limited = createTestApp(db, { auth: { rateLimit: true } }).app;
    const signIn = () =>
      limited.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.7' },
        body: JSON.stringify({ email: 'ada@example.com', password: `${PASSWORD}-wrong` }),
      });
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 10 && last?.status !== 429; i += 1) {
      last = await signIn();
      statuses.push(last.status);
    }
    expect(statuses[0]).toBe(401);
    await expectRateLimited(last!);
  });
});

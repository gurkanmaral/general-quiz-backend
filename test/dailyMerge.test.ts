import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DailyMergeResponseSchema, ProblemSchema, type DailyPlay } from '../src/contracts';
import { rotationSlug } from '../src/shared';
import schedule from '../content/daily/schedule.json';
import { importContent } from '../src/modules/content';
import { openTestDatabase } from './db';
import { createSignedInUser, createTestApp, jsonRequest } from './auth';

const database = openTestDatabase();
const NOW = new Date('2026-11-16T12:00:00Z');
const { app, mailer } = createTestApp(database.db, { now: () => NOW });
const CONTENT_DIR = new URL('../content', import.meta.url).pathname;
let cookie = '';

beforeAll(async () => {
  await importContent(database.db, CONTENT_DIR);
  cookie = await createSignedInUser(app, mailer, 'merger@example.com');
});
afterAll(() => database.close());

async function correctIndexOf(dailyDate: string): Promise<number> {
  const res = await app.request(`/api/v1/daily/${dailyDate}`);
  return ((await res.json()) as { question: { correctIndex: number } }).question.correctIndex;
}

function localPlay(dailyDate: string, overrides: Partial<DailyPlay> = {}): DailyPlay {
  return {
    dailyDate,
    questionSlug: rotationSlug(schedule.rotation, dailyDate)!,
    selectedIndex: 0,
    correct: false,
    answeredAt: `${dailyDate}T08:00:00.000Z`,
    playedOn: dailyDate,
    ...overrides,
  };
}

function merge(plays: DailyPlay[], today = '2026-11-16', session = cookie) {
  return app.request('/api/v1/daily/merge', jsonRequest('POST', { today, plays }, session));
}

describe('POST /api/v1/daily/merge (Story 1.6)', () => {
  it('requires a signed-in player and a valid body', async () => {
    expect((await merge([], '2026-11-16', '')).status).toBe(401);
    const bad = await app.request('/api/v1/daily/merge', jsonRequest('POST', { plays: 'nope' }, cookie));
    expect(bad.status).toBe(400);
    expect(ProblemSchema.parse(await bad.json()).code).toBe('daily.invalidMerge');
    const badToday = await merge([], '2026-11-01');
    expect(ProblemSchema.parse(await badToday.json()).code).toBe('daily.invalidPlayedOn');
  });

  it('adds the local history and recomputes correctness and the Streak on the server', async () => {
    // The server has 11-16 already (answered today on this account).
    const right16 = await correctIndexOf('2026-11-16');
    expect((await app.request('/api/v1/daily/2026-11-16/answer', jsonRequest('POST', { selectedIndex: right16, playedOn: '2026-11-16' }, cookie))).status).toBe(200);

    const right14 = await correctIndexOf('2026-11-14');
    const res = await merge([
      // Claims "wrong" but picked the right option: the server decides.
      localPlay('2026-11-14', { selectedIndex: right14, correct: false }),
      // 11-15 caught up late on 11-16.
      localPlay('2026-11-15', { playedOn: '2026-11-16', answeredAt: '2026-11-16T07:00:00.000Z' }),
    ]);
    expect(res.status).toBe(200);
    const body = DailyMergeResponseSchema.parse(await res.json());
    expect(body.merged).toBe(2);
    expect(body.skipped).toBe(0);
    expect(body.plays.map((play) => [play.dailyDate, play.correct])).toEqual([
      ['2026-11-14', true],
      ['2026-11-15', false],
      ['2026-11-16', true],
    ]);
    expect(body.streak).toEqual({ current: 3, best: 3 });
  });

  it('keeps the earliest answeredAt on a conflict', async () => {
    // Local answered 11-16 earlier than the server's 12:00Z answer: the local one wins.
    const earlier = await merge([localPlay('2026-11-16', { selectedIndex: 3, answeredAt: '2026-11-16T06:00:00.000Z' })]);
    const afterEarlier = DailyMergeResponseSchema.parse(await earlier.json());
    expect(afterEarlier.merged).toBe(1);
    expect(afterEarlier.plays.find((play) => play.dailyDate === '2026-11-16')).toMatchObject({ selectedIndex: 3, answeredAt: '2026-11-16T06:00:00.000Z' });

    // A later local answer for the same date changes nothing.
    const later = await merge([localPlay('2026-11-16', { selectedIndex: 1, answeredAt: '2026-11-16T11:00:00.000Z' })]);
    const afterLater = DailyMergeResponseSchema.parse(await later.json());
    expect(afterLater.merged).toBe(0);
    expect(afterLater.plays.find((play) => play.dailyDate === '2026-11-16')?.selectedIndex).toBe(3);
  });

  it('is idempotent: posting the same history twice changes nothing', async () => {
    const plays = [localPlay('2026-11-10'), localPlay('2026-11-11')];
    expect(DailyMergeResponseSchema.parse(await (await merge(plays)).json()).merged).toBe(2);
    const again = DailyMergeResponseSchema.parse(await (await merge(plays)).json());
    expect(again.merged).toBe(0);
    expect(again.plays.filter((play) => play.dailyDate === '2026-11-10')).toHaveLength(1);
  });

  it('skips impossible plays and keeps the local result for a Question the server no longer has', async () => {
    const res = await merge([
      localPlay('2026-11-20'), // future Daily Date
      localPlay('2026-11-12', { playedOn: '2026-11-11' }), // played before its date
      localPlay('2026-11-09', { answeredAt: '2027-01-01T00:00:00.000Z' }), // answered in the future
      localPlay('2026-11-08', { questionSlug: 'retired-question', selectedIndex: 2, correct: true }),
    ]);
    const body = DailyMergeResponseSchema.parse(await res.json());
    expect(body.skipped).toBe(3);
    expect(body.merged).toBe(1);
    expect(body.plays.find((play) => play.dailyDate === '2026-11-08')).toMatchObject({ questionSlug: 'retired-question', correct: true });
    expect(body.plays.some((play) => ['2026-11-20', '2026-11-12', '2026-11-09'].includes(play.dailyDate))).toBe(false);
  });
});

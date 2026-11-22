import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DailyAnswerResponseSchema, DailyHistoryResponseSchema, ProblemSchema } from '../src/contracts';
import { rotationSlug } from '../src/shared';
import schedule from '../content/daily/schedule.json';
import { importContent } from '../src/modules/content';
import { isTodaySomewhere } from '../src/modules/daily';
import { openTestDatabase } from './db';
import { createSignedInUser, createTestApp, jsonRequest } from './auth';

const database = openTestDatabase();
let clock = new Date('2026-11-16T12:00:00Z');
const { app, mailer } = createTestApp(database.db, { now: () => clock });
const CONTENT_DIR = new URL('../content', import.meta.url).pathname;
let ada = '';
let bob = '';

beforeAll(async () => {
  await importContent(database.db, CONTENT_DIR);
  ada = await createSignedInUser(app, mailer, 'ada@example.com');
  bob = await createSignedInUser(app, mailer, 'bob@example.com');
});
afterAll(() => database.close());

async function correctIndex(dailyDate: string): Promise<number> {
  const res = await app.request(`/api/v1/daily/${dailyDate}`);
  return ((await res.json()) as { question: { correctIndex: number } }).question.correctIndex;
}

function answer(cookie: string, dailyDate: string, selectedIndex: number, playedOn: string) {
  return app.request(`/api/v1/daily/${dailyDate}/answer`, jsonRequest('POST', { selectedIndex, playedOn }, cookie));
}

async function history(cookie: string, today: string) {
  const res = await app.request(`/api/v1/daily/history?today=${today}`, jsonRequest('GET', undefined, cookie));
  expect(res.status).toBe(200);
  return DailyHistoryResponseSchema.parse(await res.json());
}

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(ProblemSchema.parse(await res.json()).code).toBe(code);
}

describe('POST /api/v1/daily/:dailyDate/answer (Story 1.5)', () => {
  it('requires a signed-in player', async () => {
    await expectProblem(await answer('', '2026-11-16', 0, '2026-11-16'), 401, 'accounts.unauthorized');
    await expectProblem(await app.request('/api/v1/daily/history?today=2026-11-16'), 401, 'accounts.unauthorized');
  });

  it('stores the answer, decides correctness on the server and returns the Streak', async () => {
    const right = await correctIndex('2026-11-16');
    const res = await answer(ada, '2026-11-16', right, '2026-11-16');
    expect(res.status).toBe(200);
    const body = DailyAnswerResponseSchema.parse(await res.json());
    expect(body.play).toMatchObject({
      dailyDate: '2026-11-16',
      questionSlug: rotationSlug(schedule.rotation, '2026-11-16'),
      selectedIndex: right,
      correct: true,
      playedOn: '2026-11-16',
      answeredAt: '2026-11-16T12:00:00.000Z',
    });
    expect(body.correctIndex).toBe(right);
    expect(body.streak).toEqual({ current: 1, best: 1 });
  });

  it('keeps the first answer only (FR-8)', async () => {
    const wrong = ((await correctIndex('2026-11-16')) + 1) % 4;
    await expectProblem(await answer(ada, '2026-11-16', wrong, '2026-11-16'), 409, 'daily.alreadyAnswered');
    const { plays } = await history(ada, '2026-11-16');
    expect(plays).toHaveLength(1);
    expect(plays[0]!.correct).toBe(true);
  });

  it('records a wrong answer as wrong', async () => {
    const wrong = ((await correctIndex('2026-11-15')) + 1) % 4;
    const body = DailyAnswerResponseSchema.parse(await (await answer(bob, '2026-11-15', wrong, '2026-11-15')).json());
    expect(body.play.correct).toBe(false);
    expect(body.streak).toEqual({ current: 1, best: 1 });
  });

  it('lets a missed day be played late within the 3-day repair window, restoring the Streak', async () => {
    // Ada played 11-16 on time; 11-15 is missed. 11-14 on time, then 11-15 caught up on 11-16.
    clock = new Date('2026-11-14T12:00:00Z');
    expect((await answer(ada, '2026-11-14', 0, '2026-11-14')).status).toBe(200);
    clock = new Date('2026-11-16T12:00:00Z');
    const late = DailyAnswerResponseSchema.parse(await (await answer(ada, '2026-11-15', 0, '2026-11-16')).json());
    expect(late.play.playedOn).toBe('2026-11-16');
    expect(late.streak).toEqual({ current: 3, best: 3 });

    // 11-13 on 11-16 is exactly 3 days late: still allowed.
    expect((await answer(ada, '2026-11-13', 0, '2026-11-16')).status).toBe(200);
  });

  it('records a Library day older than the repair window without counting it for the Streak', async () => {
    const cy = await createSignedInUser(app, mailer, 'cy@example.com');
    expect((await answer(cy, '2026-11-16', 0, '2026-11-16')).status).toBe(200);
    // 11-12 on 11-16 is 4 days late: stored (Library), but not counted for the Streak.
    const late = DailyAnswerResponseSchema.parse(await (await answer(cy, '2026-11-12', 0, '2026-11-16')).json());
    expect(late.play).toMatchObject({ dailyDate: '2026-11-12', playedOn: '2026-11-16' });
    expect(late.streak).toEqual({ current: 1, best: 1 });
    expect((await answer(cy, '2026-10-01', 0, '2026-11-16')).status).toBe(200);
    const { plays, streak } = await history(cy, '2026-11-16');
    expect(plays.map((play) => play.dailyDate)).toEqual(['2026-10-01', '2026-11-12', '2026-11-16']);
    expect(streak).toEqual({ current: 1, best: 1 });
  });

  it('refuses dates after playedOn', async () => {
    await expectProblem(await answer(ada, '2026-11-17', 0, '2026-11-16'), 422, 'daily.answerWindowClosed');
  });

  it('accepts playedOn only when it is "today" somewhere on Earth (AD-5)', async () => {
    await expectProblem(await answer(bob, '2026-11-14', 0, '2026-11-14'), 400, 'daily.invalidPlayedOn');
    await expectProblem(await answer(bob, '2026-11-16', 0, '2026-11-18'), 400, 'daily.invalidPlayedOn');
    // 2026-11-17 is already today in UTC+14 at 12:00Z.
    expect((await answer(bob, '2026-11-17', 0, '2026-11-17')).status).toBe(200);
    expect(isTodaySomewhere('2026-11-15', clock)).toBe(true); // UTC−14 is still 11-15 22:00
    expect(isTodaySomewhere('2026-11-14', clock)).toBe(false);
  });

  it('validates the Daily Date and the body', async () => {
    await expectProblem(await answer(bob, '2026-02-30', 0, '2026-11-16'), 400, 'daily.invalidDate');
    await expectProblem(await answer(bob, '2026-11-20', 0, '2026-11-16'), 400, 'daily.invalidDate');
    await expectProblem(await answer(bob, '2026-11-16', 4, '2026-11-16'), 400, 'daily.invalidAnswer');
    await expectProblem(
      await app.request('/api/v1/daily/2026-11-16/answer', jsonRequest('POST', { selectedIndex: '1' }, bob)),
      400,
      'daily.invalidAnswer',
    );
  });
});

describe('GET /api/v1/daily/history (Story 1.5)', () => {
  it('lists answered Daily Dates (oldest first) with the Streak for the given local today', async () => {
    const result = await history(ada, '2026-11-16');
    expect(result.plays.map((play) => play.dailyDate)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']);
    expect(result.streak).toEqual({ current: 4, best: 4 });
    // Seen from a later "today", the run has ended but best stays.
    clock = new Date('2026-11-19T12:00:00Z');
    expect((await history(ada, '2026-11-19')).streak).toEqual({ current: 0, best: 4 });
    clock = new Date('2026-11-16T12:00:00Z');
  });

  it('is the same on a second browser (a second session of the same player)', async () => {
    const second = await createSignedInUserAgain('ada@example.com');
    expect(await history(second, '2026-11-16')).toEqual(await history(ada, '2026-11-16'));
  });

  it("never shows another player's answers", async () => {
    const result = await history(bob, '2026-11-16');
    expect(result.plays.map((play) => play.dailyDate)).toEqual(['2026-11-15', '2026-11-17']);
  });

  it('requires a valid local today', async () => {
    for (const today of ['', '2026-11-30', 'nope']) {
      const res = await app.request(`/api/v1/daily/history?today=${today}`, jsonRequest('GET', undefined, ada));
      await expectProblem(res, 400, 'daily.invalidPlayedOn');
    }
  });
});

/** A fresh sign-in (new session) for an existing confirmed player. */
async function createSignedInUserAgain(email: string): Promise<string> {
  const res = await app.request('/api/auth/sign-in/email', jsonRequest('POST', { email, password: 'correct-horse-9' }));
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');
}

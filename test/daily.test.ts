import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DailyResponseSchema, ProblemSchema } from '@general-quiz/contracts';
import { rotationSlug } from '@general-quiz/shared';
import schedule from '../../../content/daily/schedule.json';
import { scheduleEntry } from '../src/db/schema';
import { createApp } from '../src/http/app';
import { createLogger } from '../src/logger';
import { importContent } from '../src/modules/content';
import { isAcceptableDailyDate } from '../src/modules/daily';
import { openTestDatabase, truncateAll } from './db';

const database = openTestDatabase();
const NOW = new Date('2026-11-16T12:00:00Z');
const app = createApp({ db: database.db, logger: createLogger('silent'), now: () => NOW });
const CONTENT_DIR = new URL('../../../content', import.meta.url).pathname;

beforeAll(() => importContent(database.db, CONTENT_DIR));
afterAll(() => database.close());

async function getDaily(date: string) {
  return app.request(`/api/v1/daily/${date}`);
}

async function expectInvalidDate(date: string) {
  const res = await getDaily(date);
  expect(res.status).toBe(400);
  expect(res.headers.get('content-type')).toBe('application/problem+json');
  expect(ProblemSchema.parse(await res.json()).code).toBe('daily.invalidDate');
}

describe('GET /api/v1/daily/:dailyDate', () => {
  it("returns today's Question with options, correct option, story, facts and links", async () => {
    const res = await getDaily('2026-11-16');
    expect(res.status).toBe(200);
    const body = DailyResponseSchema.parse(await res.json());
    expect(body.dailyDate).toBe('2026-11-16');
    // Same rotation as the web app's bundled questionForDate (2026-11-16 → Thriller).
    expect(body.question.slug).toBe('thriller-album');
    expect(body.question.slug).toBe(rotationSlug(schedule.rotation, '2026-11-16'));
    expect(body.question.options.map((option) => option.en)).toEqual(['Prince', 'Michael Jackson', 'Stevie Wonder', 'David Bowie']);
    expect(body.question.correctIndex).toBe(1);
    expect(body.question.answerTitle.en).toMatch(/Michael Jackson/);
    expect(body.question.facts).toHaveLength(3);
    expect(body.question.video.url).toMatch(/^https:\/\//);
    expect(body.question.source.url).toBe('https://www.grammy.com/artists/michael-jackson/13202');
  });

  it('accepts the dates that are today at the UTC−14 h and UTC+14 h edges', async () => {
    for (const date of ['2026-11-15', '2026-11-17']) {
      const res = await getDaily(date);
      expect(res.status).toBe(200);
      expect(DailyResponseSchema.parse(await res.json()).question.slug).toBe(rotationSlug(schedule.rotation, date));
    }
  });

  it('rejects dates outside today-somewhere with daily.invalidDate', async () => {
    await expectInvalidDate('2026-11-14');
    await expectInvalidDate('2026-11-18');
  });

  it('rejects malformed and impossible dates with daily.invalidDate', async () => {
    for (const date of ['2026-02-30', '20261116', 'abc', '2026-11-16T00:00']) await expectInvalidDate(date);
  });

  it('lets an explicit schedule entry override the rotation', async () => {
    await database.db.insert(scheduleEntry).values({ dailyDate: '2026-11-17', questionSlug: 'largest-desert' });
    const body = DailyResponseSchema.parse(await (await getDaily('2026-11-17')).json());
    expect(body.question.slug).toBe('largest-desert');
  });
});

describe('isAcceptableDailyDate', () => {
  it('moves the window with the clock', () => {
    const lateUtc = new Date('2026-11-16T23:30:00Z'); // UTC+14 is already 11-17 13:30, UTC−14 is 11-16 09:30
    expect(isAcceptableDailyDate('2026-11-15', lateUtc)).toBe(false);
    expect(isAcceptableDailyDate('2026-11-16', lateUtc)).toBe(true);
    expect(isAcceptableDailyDate('2026-11-17', lateUtc)).toBe(true);
  });
});

describe('with nothing imported', () => {
  beforeEach(() => truncateAll(database.db));
  afterAll(() => importContent(database.db, CONTENT_DIR));

  it('returns 404 daily.notScheduled', async () => {
    const res = await getDaily('2026-11-16');
    expect(res.status).toBe(404);
    expect(ProblemSchema.parse(await res.json()).code).toBe('daily.notScheduled');
  });
});

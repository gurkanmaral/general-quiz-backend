import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DailyResponseSchema, ProblemSchema } from '@general-quiz/contracts';
import { rotationSlug } from '@general-quiz/shared';
import schedule from '../content/daily/schedule.json';
import { scheduleEntry } from '../src/db/schema';
import { createApp } from '../src/http/app';
import { createLogger } from '../src/logger';
import { importContent } from '../src/modules/content';
import { isAcceptableDailyDate } from '../src/modules/daily';
import { openTestDatabase, truncateAll } from './db';

const database = openTestDatabase();
const NOW = new Date('2026-11-16T12:00:00Z');
const app = createApp({ db: database.db, logger: createLogger('silent'), now: () => NOW });
const CONTENT_DIR = new URL('../content', import.meta.url).pathname;

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
    expect(body.question.video?.url).toMatch(/^https:\/\//);
    expect(body.question.source.url).toBe('https://www.grammy.com/artists/michael-jackson/13202');
  });

  it('accepts past dates (Library) and the UTC+14 "today", with the rotation question', async () => {
    for (const date of ['2026-11-17', '2026-11-15', '2026-11-14', '2025-01-01']) {
      const res = await getDaily(date);
      expect(res.status).toBe(200);
      expect(DailyResponseSchema.parse(await res.json()).question.slug).toBe(rotationSlug(schedule.rotation, date));
    }
  });

  it('rejects dates after the latest "today on Earth" (UTC+14) with daily.invalidDate', async () => {
    await expectInvalidDate('2026-11-18');
    await expectInvalidDate('2027-01-01');
  });

  it('rejects malformed and impossible dates with daily.invalidDate', async () => {
    for (const date of ['2026-02-30', '20261116', 'abc', '2026-11-16T00:00']) await expectInvalidDate(date);
  });

  it('lets an explicit schedule entry override the rotation', async () => {
    await database.db.insert(scheduleEntry).values({ dailyDate: '2026-11-17', questionSlug: 'largest-desert' });
    const body = DailyResponseSchema.parse(await (await getDaily('2026-11-17')).json());
    expect(body.question.slug).toBe('largest-desert');
  });

  it("falls back to the rotation when an entry's question is not published", async () => {
    await database.db.insert(scheduleEntry).values({ dailyDate: '2026-11-15', questionSlug: 'no-longer-published' });
    const body = DailyResponseSchema.parse(await (await getDaily('2026-11-15')).json());
    expect(body.question.slug).toBe(rotationSlug(schedule.rotation, '2026-11-15'));
  });
});

describe('isAcceptableDailyDate', () => {
  it('moves the upper bound with the clock (UTC+14)', () => {
    const early = new Date('2026-11-16T09:59:00Z'); // UTC+14 is 11-16 23:59
    const late = new Date('2026-11-16T10:00:00Z'); // UTC+14 is 11-17 00:00
    expect(isAcceptableDailyDate('2026-11-17', early)).toBe(false);
    expect(isAcceptableDailyDate('2026-11-17', late)).toBe(true);
    expect(isAcceptableDailyDate('2026-11-18', late)).toBe(false);
    expect(isAcceptableDailyDate('2020-02-29', late)).toBe(true);
    expect(isAcceptableDailyDate('2021-02-29', late)).toBe(false);
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

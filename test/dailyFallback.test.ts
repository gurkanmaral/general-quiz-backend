import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DailyResponseSchema } from '../src/contracts';
import { fallbackAssignment } from '../src/db/schema';
import { importContent } from '../src/modules/content';
import { pickFallback } from '../src/modules/daily';
import { openTestDatabase, truncateAll } from './db';
import { createTestApp } from './auth';

const database = openTestDatabase();
const db = database.db;
const NOW = new Date('2026-11-16T12:00:00Z');
const { app } = createTestApp(db, { now: () => NOW });
const REPO_CONTENT = new URL('../content', import.meta.url).pathname;
const POOL = ['earth-atmosphere', 'first-modern-olympics', 'http-meaning', 'largest-desert', 'lotr-oscars', 'moby-dick-opening', 'thriller-album'];
let dir: string;

async function writeSchedule(schedule: unknown) {
  await writeFile(join(dir, 'daily/schedule.json'), JSON.stringify(schedule));
}
const dailySlug = async (date: string) => DailyResponseSchema.parse(await (await app.request(`/api/v1/daily/${date}`)).json()).question.slug;
const stored = () => db.select().from(fallbackAssignment).orderBy(asc(fallbackAssignment.dailyDate));

beforeAll(async () => {
  await truncateAll(db);
  dir = await mkdtemp(join(tmpdir(), 'kno-fallback-'));
  await cp(REPO_CONTENT, dir, { recursive: true });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await database.close();
});

describe('Daily fallback (Story 6.2, FR-37)', () => {
  it('picks deterministically among unused pool Questions, cycling when all are used', () => {
    expect(pickFallback(POOL, new Set(), '1970-01-03')).toBe(POOL[2]);
    expect(pickFallback(POOL, new Set(POOL.slice(0, 6)), '2026-11-16')).toBe('thriller-album');
    // All used: cycle the whole pool.
    expect(pickFallback(POOL, new Set(POOL), '1970-01-08')).toBe(POOL[0]);
    expect(pickFallback([], new Set(), '2026-11-16')).toBeUndefined();
  });

  it('import warns when fewer than 14 future Daily Dates are scheduled', async () => {
    expect((await importContent(db, REPO_CONTENT, NOW)).warnings).toEqual([]);
    const entries = Array.from({ length: 14 }, (_, i) => ({ dailyDate: `2026-11-${String(17 + i).padStart(2, '0')}`, question: 'lotr-oscars', status: 'published' }));
    entries[13] = { ...entries[13]!, dailyDate: '2026-11-30' };
    await writeSchedule({ rotation: { anchor: '1970-01-01', questions: [] }, entries: entries.slice(0, 13) });
    const report = await importContent(db, dir, NOW);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatch(/Only 13 of the next 14 Daily Dates are scheduled; 2026-11-30 will use fallback/);
    await writeSchedule({ rotation: { anchor: '1970-01-01', questions: [] }, entries });
    expect((await importContent(db, dir, NOW)).warnings).toEqual([]);
  });

  it('stores a fallback for an unscheduled Daily Date and keeps it', async () => {
    await writeSchedule({ rotation: { anchor: '1970-01-01', questions: [] }, entries: [{ dailyDate: '2026-11-16', question: 'lotr-oscars', status: 'published' }] });
    expect((await importContent(db, dir, NOW)).warnings).toHaveLength(1);
    await db.delete(fallbackAssignment);

    // The explicit entry wins and stores nothing.
    expect(await dailySlug('2026-11-16')).toBe('lotr-oscars');
    expect(await stored()).toEqual([]);

    const unused = POOL.filter((slug) => slug !== 'lotr-oscars');
    const first = await dailySlug('2026-11-15');
    expect(first).toBe(pickFallback(POOL, new Set(['lotr-oscars']), '2026-11-15'));
    expect(unused).toContain(first);
    expect(await dailySlug('2026-11-15')).toBe(first);
    const second = await dailySlug('2026-11-14');
    expect(second).toBe(pickFallback(POOL, new Set(['lotr-oscars', first]), '2026-11-14'));
    expect(second).not.toBe(first);
    expect((await stored()).map((row) => [row.dailyDate, row.questionSlug])).toEqual([
      ['2026-11-14', second],
      ['2026-11-15', first],
    ]);

    // Future dates stay hidden and get nothing (AD-5).
    expect((await app.request('/api/v1/daily/2026-11-30')).status).toBe(400);
    expect(await stored()).toHaveLength(2);

    // A stored fallback survives a later import that adds a rotation.
    await importContent(db, REPO_CONTENT, NOW);
    expect(await dailySlug('2026-11-15')).toBe(first);
  });
});

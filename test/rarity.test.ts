import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SoloAnswerResponseSchema, SoloGameResponseSchema, type SoloGameResponse } from '@general-quiz/contracts';
import { question, rarity } from '../src/db/schema';
import { createLogger } from '../src/logger';
import { importContent } from '../src/modules/content';
import { rarityOf, startRarityJob } from '../src/modules/progress';
import { openTestDatabase } from './db';
import { createSignedInUser, createTestApp, jsonRequest } from './auth';
import { repoContent } from './contentStats';

const database = openTestDatabase();
const db = database.db;
const clock = new Date('2026-11-16T12:00:00Z');
const { app, mailer } = createTestApp(db, { now: () => clock });
const CONTENT_DIR = new URL('../content', import.meta.url).pathname;
const users: Record<string, string> = {};

beforeAll(async () => {
  await importContent(db, CONTENT_DIR);
  for (const name of ['ada', 'bob', 'cy', 'dee']) users[name] = await createSignedInUser(app, mailer, `${name}@example.com`);
});
afterAll(() => database.close());

async function playGame(cookie: string, slug: string, allRight: boolean) {
  const game: SoloGameResponse = SoloGameResponseSchema.parse(
    await (await app.request(`/api/v1/quizzes/${slug}/games`, jsonRequest('POST', undefined, cookie))).json(),
  );
  const rows = await db.select().from(question).where(inArray(question.slug, game.questions.map((item) => item.slug)));
  const right = new Map(rows.map((row) => [row.slug, row.correctIndex]));
  let last;
  for (const item of game.questions) {
    const index = right.get(item.slug)!;
    const res = await app.request(
      `/api/v1/solo-games/${game.gameId}/answers`,
      jsonRequest('POST', { position: item.position, selectedIndex: allRight ? index : (index + 1) % 4 }, cookie),
    );
    last = SoloAnswerResponseSchema.parse(await res.json());
  }
  return last!;
}

describe('Rarity (Story 3.2)', () => {
  it('celebrates with "New" before the job has ever run', async () => {
    const last = await playGame(users.ada!, 'lord-of-the-rings', true);
    expect(last.unlocks.map((item) => [item.slug, item.rarity])).toEqual([['lotr-frodo', { percent: null, label: 'New' }]]);
  });

  it('stores the share of Ranked Accounts holding each item, with a "<1%" floor', async () => {
    // Ranked: ada (Solo), bob (Daily), cy (a finished Solo Game, all wrong). dee never played.
    expect((await app.request('/api/v1/daily/2026-11-16/answer', jsonRequest('POST', { selectedIndex: 0, playedOn: '2026-11-16' }, users.bob))).status).toBe(200);
    await playGame(users.cy!, 'solar-system', false);

    const report = await app.progress.computeRarity();
    expect(report).toEqual({ rankedAccounts: 3, items: repoContent.awards });
    const stored = await rarityOf(db, ['lotr-frodo', 'lotr-gandalf', 'solar-voyager']);
    expect(stored.get('lotr-frodo')).toEqual({ percent: 33.33, label: '33%' });
    expect(stored.get('lotr-gandalf')).toEqual({ percent: 0, label: '<1%' });
    const [row] = await db.select().from(rarity).where(inArray(rarity.awardSlug, ['lotr-frodo']));
    expect(row).toMatchObject({ holders: 1, rankedAccounts: 3 });
  });

  it('celebrations read the stored value, not a live count (AD-11)', async () => {
    const last = await playGame(users.bob!, 'lord-of-the-rings', true);
    expect(last.unlocks.find((item) => item.slug === 'lotr-frodo')?.rarity).toEqual({ percent: 33.33, label: '33%' });
    // Recomputing picks up Bob's Frodo: 2 of 3 Ranked Accounts.
    await app.progress.computeRarity();
    expect((await rarityOf(db, ['lotr-frodo'])).get('lotr-frodo')?.label).toBe('67%');
  });

  it('drops deleted accounts from holders and from the Ranked Accounts (FR-4)', async () => {
    expect((await app.request('/api/v1/me', jsonRequest('DELETE', { confirm: 'DELETE' }, users.ada))).status).toBe(204);
    await app.progress.computeRarity();
    const [row] = await db.select().from(rarity).where(inArray(rarity.awardSlug, ['lotr-frodo']));
    expect(row).toMatchObject({ holders: 1, rankedAccounts: 2, percent: 50 });
  });
});

describe('startRarityJob', () => {
  it('runs at startup and every 24 hours, and logs failures without throwing', async () => {
    vi.useFakeTimers();
    try {
      const logger = createLogger('silent');
      const error = vi.spyOn(logger, 'error');
      const run = vi
        .fn()
        .mockResolvedValueOnce({ rankedAccounts: 1, items: 1 })
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValue({ rankedAccounts: 1, items: 1 });
      const job = startRarityJob(run, logger);
      await job.ready;
      expect(run).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(run).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(run).toHaveBeenCalledTimes(3);
      job.stop();
      await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
      expect(run).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

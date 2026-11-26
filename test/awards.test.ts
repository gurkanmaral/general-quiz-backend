import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuizListResponseSchema, SoloAnswerResponseSchema, SoloGameResponseSchema, type SoloAnswerResponse, type SoloGameResponse } from '../src/contracts';
import { award, question, userAward } from '../src/db/schema';
import { importContent } from '../src/modules/content';
import { openTestDatabase } from './db';
import { createSignedInUser, createTestApp, jsonRequest } from './auth';

const database = openTestDatabase();
const db = database.db;
const { app, mailer } = createTestApp(db);
const CONTENT_DIR = new URL('../content', import.meta.url).pathname;
let ada = '';

beforeAll(async () => {
  await importContent(db, CONTENT_DIR);
  ada = await createSignedInUser(app, mailer, 'ada@example.com');
});
afterAll(() => database.close());

async function start(slug = 'lord-of-the-rings'): Promise<SoloGameResponse> {
  const res = await app.request(`/api/v1/quizzes/${slug}/games`, jsonRequest('POST', undefined, ada));
  return SoloGameResponseSchema.parse(await res.json());
}

/** Plays a whole game answering everything right; returns the last answer. */
async function playPerfect(game: SoloGameResponse) {
  const rows = await db
    .select({ slug: question.slug, correctIndex: question.correctIndex })
    .from(question)
    .where(inArray(question.slug, game.questions.map((item) => item.slug)));
  const right = new Map(rows.map((row) => [row.slug, row.correctIndex]));
  let last: SoloAnswerResponse | undefined;
  for (const item of game.questions) {
    const res = await app.request(`/api/v1/solo-games/${game.gameId}/answers`, jsonRequest('POST', { position: item.position, selectedIndex: right.get(item.slug)! }, ada));
    last = SoloAnswerResponseSchema.parse(await res.json());
    if (item.position < game.questions.length - 1) expect(last.unlocks).toEqual([]);
  }
  return last!;
}

describe('Badges and Titles from Unlock Rules (Story 3.1)', () => {
  it('lists the Badges and Titles each Quiz can award on its card (FR-13)', async () => {
    const quizzes = QuizListResponseSchema.parse(await (await app.request('/api/v1/quizzes')).json()).quizzes;
    const lotr = quizzes.find((item) => item.slug === 'lord-of-the-rings')!;
    expect(lotr.awards.map((item) => [item.kind, item.name.en, item.icon])).toEqual([
      ['badge', 'Middle-earth Fan', '🏅'],
      ['title', 'Gandalf', '🧙'],
      ['title', 'Frodo', '💍'],
    ]);
  });

  it('grants newly met items after a finished game and returns them to celebrate', async () => {
    // 10 of 20 Questions right (50%): Frodo (correctShare 0.5) unlocks; Gandalf needs all 6 Expert.
    const last = await playPerfect(await start());
    expect(last.unlocks.map((item) => [item.kind, item.slug])).toEqual([['title', 'lotr-frodo']]);
    expect(last.unlocks[0]).toMatchObject({ quizSlug: 'lord-of-the-rings', name: { en: 'Frodo' }, icon: '💍' });
    expect(last.unlocks[0]!.description.en).toBeTruthy();
  });

  it('grants each item once and keeps earlier ones', async () => {
    // The next game draws the 10 Questions not yet answered correctly: 100%, all Expert done.
    const last = await playPerfect(await start());
    expect(last.unlocks.map((item) => item.slug).sort()).toEqual(['lotr-gandalf', 'lotr-middle-earth-fan']);
    const again = await playPerfect(await start());
    expect(again.unlocks).toEqual([]);
    const rows = await db.select().from(userAward);
    expect(rows.map((row) => row.awardSlug).sort()).toEqual(['lotr-frodo', 'lotr-gandalf', 'lotr-middle-earth-fan']);
  });

  it('never removes an item, even when the Question or the item is withdrawn', async () => {
    await db.update(question).set({ status: 'unpublished' }).where(eq(question.slug, 'lotr-balrog'));
    await db.update(award).set({ status: 'unpublished' }).where(eq(award.slug, 'lotr-frodo'));
    await playPerfect(await start());
    expect((await db.select().from(userAward)).map((row) => row.awardSlug).sort()).toEqual(['lotr-frodo', 'lotr-gandalf', 'lotr-middle-earth-fan']);
    await db.update(question).set({ status: 'published' }).where(eq(question.slug, 'lotr-balrog'));
    await db.update(award).set({ status: 'published' }).where(eq(award.slug, 'lotr-frodo'));
  });

  it('does not evaluate abandoned games', async () => {
    const game = await start('solar-system');
    const [first] = await db.select().from(question).where(eq(question.slug, game.questions[0]!.slug));
    await app.request(`/api/v1/solo-games/${game.gameId}/answers`, jsonRequest('POST', { position: 0, selectedIndex: first!.correctIndex }, ada));
    await start('solar-system'); // abandons it
    expect((await db.select().from(userAward).where(eq(userAward.quizSlug, 'solar-system')))).toEqual([]);
  });
});

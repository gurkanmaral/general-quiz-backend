import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuizListResponseSchema, SoloAnswerResponseSchema, SoloGameResponseSchema, type SoloGameResponse } from '@general-quiz/contracts';
import { correctQuestion, question, quizRecord, soloGame } from '../src/db/schema';
import { importContent } from '../src/modules/content';
import { isWon, toQuizRecord } from '../src/modules/progress';
import { openTestDatabase } from './db';
import { createSignedInUser, createTestApp, jsonRequest } from './auth';

const database = openTestDatabase();
const db = database.db;
const { app, mailer } = createTestApp(db);
const CONTENT_DIR = new URL('../../../content', import.meta.url).pathname;
let ada = '';
let adaId = '';

beforeAll(async () => {
  await importContent(db, CONTENT_DIR);
  ada = await createSignedInUser(app, mailer, 'ada@example.com');
  adaId = ((await (await app.request('/api/v1/me', jsonRequest('GET', undefined, ada))).json()) as { id: string }).id;
});
afterAll(() => database.close());

async function start(slug = 'lord-of-the-rings'): Promise<SoloGameResponse> {
  const res = await app.request(`/api/v1/quizzes/${slug}/games`, jsonRequest('POST', undefined, ada));
  expect(res.status).toBe(201);
  return SoloGameResponseSchema.parse(await res.json());
}

async function correctIndexes(game: SoloGameResponse): Promise<Map<string, number>> {
  const slugs = game.questions.map((item) => item.slug);
  const rows = await db.select({ slug: question.slug, correctIndex: question.correctIndex }).from(question).where(inArray(question.slug, slugs));
  return new Map(rows.map((row) => [row.slug, row.correctIndex]));
}

/** Answers `count` Questions (all by default); `right(position)` decides which are correct. */
async function play(game: SoloGameResponse, right: (position: number) => boolean, count = game.questions.length) {
  const correct = await correctIndexes(game);
  let last;
  for (const item of game.questions.slice(0, count)) {
    const index = correct.get(item.slug)!;
    const res = await app.request(
      `/api/v1/solo-games/${game.gameId}/answers`,
      jsonRequest('POST', { position: item.position, selectedIndex: right(item.position) ? index : (index + 1) % 4 }, ada),
    );
    expect(res.status).toBe(200);
    last = SoloAnswerResponseSchema.parse(await res.json());
    if (item.position < game.questions.length - 1) expect(last.record).toBeNull();
  }
  return last!;
}

async function cards() {
  const res = await app.request('/api/v1/quizzes', jsonRequest('GET', undefined, ada));
  return QuizListResponseSchema.parse(await res.json()).quizzes;
}

describe('Quiz Record (Story 2.4)', () => {
  let firstCorrect: string[] = [];

  it('records distinct correct Questions by Difficulty and games played after a finished game', async () => {
    const game = await start();
    const last = await play(game, () => true);
    firstCorrect = game.questions.map((item) => item.slug);
    expect(last.result).toEqual({ score: 10, total: 10 });
    expect(last.record).toEqual({ gamesPlayed: 1, gamesWon: 1, correctStandard: 7, correctExpert: 3, correctShare: 0.5 });
  });

  it('draws Questions not yet answered correctly first, so a replay moves toward mastery', async () => {
    const game = await start();
    expect(game.questions.map((item) => item.slug).filter((slug) => firstCorrect.includes(slug))).toEqual([]);
    // Half right: 5 new distinct correct Questions; a game under 70% is not won.
    const last = await play(game, (position) => position % 2 === 0);
    expect(last.result).toEqual({ score: 5, total: 10 });
    expect(last.record?.gamesPlayed).toBe(2);
    expect(last.record?.gamesWon).toBe(1);
    expect(last.record!.correctStandard + last.record!.correctExpert).toBe(15);
    expect(last.record!.correctShare).toBe(0.75);
  });

  it('counts the answered Questions of an abandoned game, and ignores one abandoned without answers', async () => {
    const before = (await cards()).find((item) => item.slug === 'lord-of-the-rings')!.record!;
    const game = await start();
    const correct = await correctIndexes(game);
    // Answer only the first Question (right) then start another game, abandoning this one.
    const position = game.questions[0]!;
    await app.request(
      `/api/v1/solo-games/${game.gameId}/answers`,
      jsonRequest('POST', { position: 0, selectedIndex: correct.get(position.slug)! }, ada),
    );
    const empty = await start('solar-system');
    await start('solar-system'); // abandons `empty`, which has no answers

    const after = await cards();
    const lotr = after.find((item) => item.slug === 'lord-of-the-rings')!.record!;
    expect(lotr.gamesPlayed).toBe(before.gamesPlayed + 1);
    expect(lotr.gamesWon).toBe(before.gamesWon);
    const distinctBefore = before.correctStandard + before.correctExpert;
    const distinctAfter = lotr.correctStandard + lotr.correctExpert;
    expect(distinctAfter - distinctBefore).toBe(firstCorrect.includes(position.slug) ? 0 : 1);
    expect(after.find((item) => item.slug === 'solar-system')!.record).toBeNull();
    const [abandoned] = await db.select().from(soloGame).where(eq(soloGame.id, empty.gameId));
    expect(abandoned?.status).toBe('abandoned');
  });

  it('shows the record and best result on Quiz cards, only to the player', async () => {
    const lotr = (await cards()).find((item) => item.slug === 'lord-of-the-rings')!;
    expect(lotr.best).toEqual({ score: 10, total: 10 });
    expect(lotr.record?.correctShare).toBeGreaterThanOrEqual(0.75);
    const signedOut = QuizListResponseSchema.parse(await (await app.request('/api/v1/quizzes')).json()).quizzes;
    expect(signedOut.every((item) => item.record === null)).toBe(true);
  });

  it('counts against published Questions only', async () => {
    const before = (await cards()).find((item) => item.slug === 'lord-of-the-rings')!.record!;
    const [one] = await db.select().from(correctQuestion).where(eq(correctQuestion.userId, adaId)).limit(1);
    await db.update(question).set({ status: 'unpublished' }).where(eq(question.slug, one!.questionSlug));
    const after = (await cards()).find((item) => item.slug === 'lord-of-the-rings')!.record!;
    expect(after.correctStandard + after.correctExpert).toBe(before.correctStandard + before.correctExpert - 1);
    await db.update(question).set({ status: 'published' }).where(eq(question.slug, one!.questionSlug));
  });

  it('deletes the record with the account (FR-4)', async () => {
    const res = await app.request('/api/v1/me', jsonRequest('DELETE', { confirm: 'DELETE' }, ada));
    expect(res.status).toBe(204);
    expect(await db.select().from(quizRecord).where(eq(quizRecord.userId, adaId))).toEqual([]);
    expect(await db.select().from(correctQuestion).where(eq(correctQuestion.userId, adaId))).toEqual([]);
    expect(await db.select().from(soloGame).where(eq(soloGame.userId, adaId))).toEqual([]);
  });
});

describe('toQuizRecord and isWon', () => {
  const published = new Map([
    ['a', 'standard'],
    ['b', 'standard'],
    ['c', 'expert'],
    ['d', 'expert'],
  ] as const);

  it('counts correct published Questions by Difficulty and the share of the Quiz', () => {
    expect(toQuizRecord({ gamesPlayed: 3, gamesWon: 1 }, new Set(['a', 'c', 'gone']), published)).toEqual({
      gamesPlayed: 3,
      gamesWon: 1,
      correctStandard: 1,
      correctExpert: 1,
      correctShare: 0.5,
    });
    expect(toQuizRecord({ gamesPlayed: 0, gamesWon: 0 }, new Set(), new Map()).correctShare).toBe(0);
  });

  it('wins a finished game with at least 70% correct', () => {
    expect(isWon({ status: 'finished', score: 7, total: 10 })).toBe(true);
    expect(isWon({ status: 'finished', score: 6, total: 10 })).toBe(false);
    expect(isWon({ status: 'abandoned', score: 9, total: 10 })).toBe(false);
  });
});

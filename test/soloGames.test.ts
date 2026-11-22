import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemSchema, QuizListResponseSchema, SoloAnswerResponseSchema, SoloGameResponseSchema, SoloQuestionSchema } from '@general-quiz/contracts';
import { question, soloGame } from '../src/db/schema';
import { importContent } from '../src/modules/content';
import { pickQuestions } from '../src/modules/quizzes';
import { openTestDatabase } from './db';
import { createSignedInUser, createTestApp, jsonRequest } from './auth';

const database = openTestDatabase();
const { app, mailer } = createTestApp(database.db);
const CONTENT_DIR = new URL('../content', import.meta.url).pathname;
let ada = '';
let bob = '';

beforeAll(async () => {
  await importContent(database.db, CONTENT_DIR);
  ada = await createSignedInUser(app, mailer, 'ada@example.com');
  bob = await createSignedInUser(app, mailer, 'bob@example.com');
});
afterAll(() => database.close());

async function start(cookie: string, slug = 'lord-of-the-rings') {
  const res = await app.request(`/api/v1/quizzes/${slug}/games`, jsonRequest('POST', undefined, cookie));
  expect(res.status).toBe(201);
  return SoloGameResponseSchema.parse(await res.json());
}

function answer(cookie: string, gameId: string, position: number, selectedIndex: number) {
  return app.request(`/api/v1/solo-games/${gameId}/answers`, jsonRequest('POST', { position, selectedIndex }, cookie));
}

async function correctIndexes(slugs: readonly string[]): Promise<Map<string, number>> {
  const rows = await database.db.select({ slug: question.slug, correctIndex: question.correctIndex }).from(question).where(inArray(question.slug, [...slugs]));
  return new Map(rows.map((row) => [row.slug, row.correctIndex]));
}

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(ProblemSchema.parse(await res.json()).code).toBe(code);
}

describe('POST /api/v1/quizzes/:slug/games (Story 2.3)', () => {
  it('requires a signed-in player', async () => {
    await expectProblem(await app.request('/api/v1/quizzes/lord-of-the-rings/games', jsonRequest('POST')), 401, 'accounts.unauthorized');
    await expectProblem(await app.request('/api/v1/solo-games/x/answers', jsonRequest('POST', { position: 0, selectedIndex: 0 })), 401, 'accounts.unauthorized');
  });

  it('refuses unknown quizzes and the Daily pool', async () => {
    await expectProblem(await app.request('/api/v1/quizzes/nope/games', jsonRequest('POST', undefined, ada)), 404, 'quizzes.notFound');
    await expectProblem(await app.request('/api/v1/quizzes/daily-originals/games', jsonRequest('POST', undefined, ada)), 404, 'quizzes.notFound');
  });

  it('draws 10 distinct Questions mixing Standard and Expert, without answers or stories (AD-7)', async () => {
    const res = await app.request('/api/v1/quizzes/lord-of-the-rings/games', jsonRequest('POST', undefined, ada));
    const text = await res.text();
    expect(text).not.toMatch(/correctIndex|answerTitle|summary|facts|source/);
    const game = SoloGameResponseSchema.parse(JSON.parse(text));
    expect(game.quiz).toMatchObject({ slug: 'lord-of-the-rings', category: 'Movies', theme: 'emerald' });
    expect(game.questions).toHaveLength(10);
    game.questions.forEach((item, index) => {
      expect(SoloQuestionSchema.safeParse(item).success).toBe(true);
      expect(item.position).toBe(index);
    });
    expect(new Set(game.questions.map((item) => item.slug)).size).toBe(10);
    expect(game.questions.filter((item) => item.difficulty === 'expert')).toHaveLength(3); // expertShare 0.3
    expect(game.questions.every((item) => item.slug.startsWith('lotr-'))).toBe(true);
  });
});

describe('POST /api/v1/solo-games/:gameId/answers (Story 2.3)', () => {
  it('records each answer, reveals correctness and the story, and finishes after the last Question', async () => {
    const game = await start(bob, 'solar-system');
    const right = await correctIndexes(game.questions.map((item) => item.slug));
    let expected = 0;
    for (const item of game.questions) {
      const correctIndex = right.get(item.slug)!;
      // Bob misses the first two Questions.
      const selected = item.position < 2 ? (correctIndex + 1) % 4 : correctIndex;
      const res = await answer(bob, game.gameId, item.position, selected);
      expect(res.status).toBe(200);
      const body = SoloAnswerResponseSchema.parse(await res.json());
      if (item.position >= 2) expected += 1;
      expect(body).toMatchObject({ position: item.position, correct: item.position >= 2, correctIndex, score: expected });
      expect(body.answerTitle.en).toBeTruthy();
      expect(body.source.url).toMatch(/^https:\/\//);
      expect(body.result).toEqual(item.position === game.questions.length - 1 ? { score: 8, total: 10 } : null);
    }
    const [row] = await database.db.select().from(soloGame).where(eq(soloGame.id, game.gameId));
    expect(row).toMatchObject({ status: 'finished', answered: 10, score: 8 });
    expect(row!.endedAt).toBeInstanceOf(Date);

    await expectProblem(await answer(bob, game.gameId, 9, 0), 409, 'quizzes.gameOver');
  });

  it("shows the player's best finished game on the Quizzes page", async () => {
    const res = await app.request('/api/v1/quizzes', jsonRequest('GET', undefined, bob));
    const quizzes = QuizListResponseSchema.parse(await res.json()).quizzes;
    expect(quizzes.find((item) => item.slug === 'solar-system')?.best).toEqual({ score: 8, total: 10 });
    expect(quizzes.find((item) => item.slug === 'lord-of-the-rings')?.best).toBeNull();
    const signedOut = QuizListResponseSchema.parse(await (await app.request('/api/v1/quizzes')).json()).quizzes;
    expect(signedOut.every((item) => item.best === null)).toBe(true);
  });

  it('keeps the first answer, insists on order, and hides other players’ games', async () => {
    const game = await start(ada);
    await expectProblem(await answer(ada, game.gameId, 1, 0), 422, 'quizzes.wrongPosition');
    expect((await answer(ada, game.gameId, 0, 0)).status).toBe(200);
    await expectProblem(await answer(ada, game.gameId, 0, 1), 409, 'quizzes.alreadyAnswered');
    await expectProblem(await answer(bob, game.gameId, 1, 0), 404, 'quizzes.gameNotFound');
    await expectProblem(await answer(ada, 'not-a-game', 0, 0), 404, 'quizzes.gameNotFound');
    await expectProblem(await answer(ada, game.gameId, 1, 4), 400, 'quizzes.invalidAnswer');
  });

  it('abandons the active game when the player starts another one', async () => {
    const first = await start(ada);
    expect((await answer(ada, first.gameId, 0, 0)).status).toBe(200);
    const second = await start(ada, 'solar-system');
    const [old] = await database.db.select().from(soloGame).where(eq(soloGame.id, first.gameId));
    expect(old).toMatchObject({ status: 'abandoned', answered: 1 });
    await expectProblem(await answer(ada, first.gameId, 1, 0), 409, 'quizzes.gameOver');
    expect((await answer(ada, second.gameId, 0, 0)).status).toBe(200);
  });
});

describe('pickQuestions', () => {
  const pool = (standard: number, expert: number) => [
    ...Array.from({ length: standard }, (_, i) => ({ slug: `s${i}`, difficulty: 'standard' as const })),
    ...Array.from({ length: expert }, (_, i) => ({ slug: `e${i}`, difficulty: 'expert' as const })),
  ];

  it('uses the Expert share and tops up from the other Difficulty', () => {
    expect(pickQuestions(pool(20, 20), 0.3, Math.random).filter((slug) => slug.startsWith('e'))).toHaveLength(3);
    expect(pickQuestions(pool(20, 1), 0.3, Math.random).filter((slug) => slug.startsWith('e'))).toHaveLength(1);
    const fewStandard = pickQuestions(pool(2, 20), 0.3, Math.random);
    expect(fewStandard).toHaveLength(10);
    expect(fewStandard.filter((slug) => slug.startsWith('s'))).toHaveLength(2);
    expect(pickQuestions(pool(3, 2), 0.3, Math.random)).toHaveLength(5);
  });

  it('draws preferred Questions first within each Difficulty', () => {
    const preferred = new Set(['s18', 's19', 'e7']);
    for (let run = 0; run < 20; run += 1) {
      const picked = pickQuestions(pool(20, 20), 0.3, Math.random, (slug) => preferred.has(slug));
      expect(picked).toEqual(expect.arrayContaining(['s18', 's19', 'e7']));
    }
  });
});

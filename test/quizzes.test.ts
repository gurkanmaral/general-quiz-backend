import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUESTION_CATEGORIES, QuizListResponseSchema } from '../src/contracts';
import { importContent } from '../src/modules/content';
import { openTestDatabase } from './db';
import { createSignedInUser, createTestApp, jsonRequest } from './auth';
import { repoContent } from './contentStats';

const database = openTestDatabase();
const { app, mailer } = createTestApp(database.db);
const CONTENT_DIR = new URL('../content', import.meta.url).pathname;
let ada = '';

beforeAll(async () => {
  await importContent(database.db, CONTENT_DIR);
  ada = await createSignedInUser(app, mailer, 'ada@example.com');
});
afterAll(() => database.close());

async function list(cookie?: string) {
  const res = await app.request('/api/v1/quizzes', jsonRequest('GET', undefined, cookie));
  expect(res.status).toBe(200);
  return QuizListResponseSchema.parse(await res.json()).quizzes;
}

describe('GET /api/v1/quizzes (Story 2.2)', () => {
  it('lists published Quizzes in Category order with Question counts, without the Daily pool', async () => {
    const quizzes = await list();
    expect(quizzes.map((item) => item.slug).sort()).toEqual([...repoContent.playableSlugs].sort());
    expect(quizzes.map((item) => item.slug)).not.toContain('daily-originals');
    const order = quizzes.map((item) => QUESTION_CATEGORIES.indexOf(item.category));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const lotr = quizzes.find((item) => item.slug === 'lord-of-the-rings')!;
    expect(lotr).toMatchObject({ category: 'Movies', questionCount: 20, standardCount: 14, expertCount: 6, theme: 'emerald', best: null });
    expect(lotr.title.en).toBe('The Lord of the Rings');
    expect(lotr.description.en).toBeTruthy();
  });

  it('works signed out and signed in', async () => {
    expect(await list(ada)).toEqual(await list());
  });

  it('never exposes Questions or answers', async () => {
    const res = await app.request('/api/v1/quizzes');
    const text = await res.text();
    expect(text).not.toMatch(/correctIndex|options|answerTitle/);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuizListResponseSchema } from '@general-quiz/contracts';
import { importContent } from '../src/modules/content';
import { openTestDatabase } from './db';
import { createSignedInUser, createTestApp, jsonRequest } from './auth';

const database = openTestDatabase();
const { app, mailer } = createTestApp(database.db);
const CONTENT_DIR = new URL('../../../content', import.meta.url).pathname;
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
    expect(quizzes.map((item) => [item.category, item.slug])).toEqual([
      ['Movies', 'lord-of-the-rings'],
      ['Science', 'solar-system'],
    ]);
    expect(quizzes[0]).toMatchObject({ questionCount: 20, standardCount: 14, expertCount: 6, theme: 'emerald', best: null });
    expect(quizzes[0]!.title.en).toBe('The Lord of the Rings');
    expect(quizzes[0]!.description.en).toBeTruthy();
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

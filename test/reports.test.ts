import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DailyResponseSchema, ProblemSchema, ReportResponseSchema } from '@general-quiz/contracts';
import { importContent, listOpenReports, resolveReports } from '../src/modules/content';
import { openTestDatabase } from './db';
import { createSignedInUser, createTestApp, jsonRequest } from './auth';

const database = openTestDatabase();
const db = database.db;
let clock = new Date('2026-11-16T12:00:00Z');
const { app, mailer } = createTestApp(db, { now: () => clock });
const CONTENT_DIR = new URL('../../../content', import.meta.url).pathname;
let ada = '';
let bob = '';
let slug = '';

beforeAll(async () => {
  await importContent(db, CONTENT_DIR);
  ada = await createSignedInUser(app, mailer, 'ada@example.com');
  bob = await createSignedInUser(app, mailer, 'bob@example.com');
  slug = DailyResponseSchema.parse(await (await app.request('/api/v1/daily/2026-11-16')).json()).question.slug;
});
afterAll(() => database.close());

const report = (cookie: string, body: unknown) => app.request('/api/v1/reports', jsonRequest('POST', body, cookie));
async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(ProblemSchema.parse(await res.json()).code).toBe(code);
}

describe('Report a wrong question (Story 6.1, FR-38)', () => {
  it('needs a signed-in player, a valid body and a known Question', async () => {
    await expectProblem(await report('', { questionSlug: slug, source: 'daily' }), 401, 'accounts.unauthorized');
    await expectProblem(await report(ada, { questionSlug: slug, source: 'quiz' }), 400, 'content.invalidReport');
    await expectProblem(await report(ada, { questionSlug: slug, source: 'daily', note: 'x'.repeat(501) }), 400, 'content.invalidReport');
    await expectProblem(await report(ada, { questionSlug: 'no-such-question', source: 'solo' }), 404, 'content.questionNotFound');
  });

  it('stores reports with an optional note, listed grouped by Question', async () => {
    const res = await report(ada, { questionSlug: slug, source: 'daily', note: '  The year is wrong.  ' });
    expect(res.status).toBe(201);
    const { id } = ReportResponseSchema.parse(await res.json());
    expect((await report(bob, { questionSlug: slug, source: 'lobby' })).status).toBe(201);
    const groups = await listOpenReports(db);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ questionSlug: slug });
    expect(groups[0]!.reports.map((item) => [item.source, item.note])).toEqual([
      ['daily', 'The year is wrong.'],
      ['lobby', null],
    ]);
    expect(await resolveReports(db, id, clock)).toBe(1);
    expect(await resolveReports(db, id, clock)).toBe(0);
    expect((await listOpenReports(db))[0]!.reports).toHaveLength(1);
    expect(await resolveReports(db, slug, clock)).toBe(1);
    expect(await listOpenReports(db)).toEqual([]);
  });

  it('allows 10 reports per hour per player, then answers 429 rateLimited', async () => {
    clock = new Date('2026-11-16T13:00:00Z');
    for (let i = 0; i < 10; i += 1) expect((await report(ada, { questionSlug: slug, source: 'solo' })).status).toBe(201);
    const limited = await report(ada, { questionSlug: slug, source: 'solo' });
    expect(limited.headers.get('Retry-After')).toBe('3600');
    await expectProblem(limited, 429, 'rateLimited');
    // Another player has their own allowance; an hour later Ada may report again.
    expect((await report(bob, { questionSlug: slug, source: 'solo' })).status).toBe(201);
    clock = new Date('2026-11-16T14:00:00Z');
    expect((await report(ada, { questionSlug: slug, source: 'solo' })).status).toBe(201);
  });
});

import { afterAll, describe, expect, it } from 'vitest';
import { HealthResponseSchema, ProblemSchema } from '@general-quiz/contracts';
import { createApp } from '../src/http/app';
import { problemBody } from '../src/http/problem';
import { createLogger } from '../src/logger';
import { openTestDatabase } from './db';

const database = openTestDatabase();
const logger = createLogger('silent');
afterAll(() => database.close());

describe('app factory', () => {
  it('serves GET /health when the database answers', async () => {
    const res = await createApp({ db: database.db, logger }).request('/health');
    expect(res.status).toBe(200);
    expect(HealthResponseSchema.parse(await res.json())).toEqual({ status: 'ok', database: 'ok' });
  });

  it('answers /health with 503 and database "down" when Postgres is unreachable', async () => {
    const broken = openTestDatabase();
    await broken.close();
    const res = await createApp({ db: broken.db, logger }).request('/health');
    expect(res.status).toBe(503);
    expect(HealthResponseSchema.parse(await res.json())).toEqual({ status: 'error', database: 'down' });
  });

  it('returns problem+json with a stable code for unknown routes', async () => {
    const res = await createApp({ db: database.db, logger }).request('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(ProblemSchema.parse(await res.json())).toMatchObject({ code: 'http.notFound', status: 404, instance: '/api/v1/nope' });
  });

  it('turns unexpected errors into a 500 problem without leaking details', async () => {
    const broken = openTestDatabase();
    await broken.close();
    const res = await createApp({ db: broken.db, logger }).request('/api/v1/quizzes');
    expect(res.status).toBe(500);
    const body = ProblemSchema.parse(await res.json());
    expect(body).toMatchObject({ code: 'http.internal', title: 'Internal server error' });
    expect(body.detail).toBeUndefined();
  });

  it('derives the problem type from the code', () => {
    expect(problemBody({ status: 400, code: 'daily.invalidDate', title: 'Invalid' })).toEqual({
      type: 'urn:kno:problem:daily.invalidDate',
      title: 'Invalid',
      status: 400,
      code: 'daily.invalidDate',
    });
  });
});

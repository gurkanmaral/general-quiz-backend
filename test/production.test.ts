import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withAdvisoryLock } from '../src/db/client';
import { createApp } from '../src/http/app';
import { createLogger } from '../src/logger';
import { createMailer, createResendMailer, type Mail } from '../src/modules/accounts';
import { parseEnv } from '../src/env';
import { openTestDatabase } from './db';

const database = openTestDatabase();
const logger = createLogger('silent');
let webDir: string;

beforeAll(async () => {
  webDir = await mkdtemp(join(tmpdir(), 'kno-web-'));
  await mkdir(join(webDir, 'assets'));
  await writeFile(join(webDir, 'index.html'), '<!doctype html><title>KNO.</title>');
  await writeFile(join(webDir, 'assets', 'index-abc.js'), 'console.log(1)');
});
afterAll(async () => {
  await rm(webDir, { recursive: true, force: true });
  await database.close();
});

describe('serving the web app from the API (Story 6.4)', () => {
  const app = () => createApp({ db: database.db, logger, webDir });

  it('serves built files and falls back to index.html for app paths', async () => {
    const asset = await app().request('/assets/index-abc.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    for (const path of ['/', '/f/abc123', '/n/xyz']) {
      const page = await app().request(path);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<title>KNO.</title>');
    }
  });

  it('leaves the API, missing files and paths outside the folder alone', async () => {
    expect((await app().request('/api/v1/nope')).headers.get('content-type')).toBe('application/problem+json');
    expect((await app().request('/health')).status).toBe(200);
    expect((await app().request('/assets/missing.js')).status).toBe(404);
    expect((await app().request('/%2e%2e/%2e%2e/package.json')).status).not.toBe(500);
    expect(await (await app().request('/..%2fpackage.json')).text()).not.toContain('"name"');
    expect((await app().request('/', { method: 'POST' })).status).toBe(404);
  });
});

describe('startup lock (Story 6.4)', () => {
  it('runs tasks under the same advisory lock one at a time', async () => {
    const events: string[] = [];
    const task = (name: string) => async () => {
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      events.push(`${name}:end`);
    };
    await Promise.all([withAdvisoryLock(database.pool, 'kno:test', task('a')), withAdvisoryLock(database.pool, 'kno:test', task('b'))]);
    expect(events).toHaveLength(4);
    expect(events[1]).toBe(`${events[0]!.split(':')[0]}:end`);
  });
});

describe('production mailer (Story 6.4)', () => {
  const mail: Mail = { kind: 'verifyCode', to: 'ada@example.com', subject: 'Confirm', text: 'Your code is 123456', code: '123456' };

  it('sends through the Resend HTTP API', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const mailer = createResendMailer({
      apiKey: 're_test',
      from: 'KNO. <hi@kno.example>',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response('{"id":"1"}', { status: 200 });
      }) as typeof fetch,
    });
    await mailer.send(mail);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ from: 'KNO. <hi@kno.example>', to: ['ada@example.com'], subject: 'Confirm', text: 'Your code is 123456' });
  });

  it('fails loudly when Resend refuses, and falls back to the dev mailer without a key', async () => {
    const mailer = createResendMailer({ apiKey: 'bad', from: 'x <x@y.z>', fetch: (async () => new Response('{"name":"validation_error"}', { status: 422 })) as unknown as typeof fetch });
    await expect(mailer.send(mail)).rejects.toThrow(/422/);
    const env = parseEnv({});
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect('lastMail' in createMailer(env)).toBe(true);
    expect('lastMail' in createMailer({ ...env, RESEND_API_KEY: 're_x' })).toBe(false);
  });
});

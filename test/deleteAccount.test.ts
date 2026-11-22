import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { MeResponseSchema, ProblemSchema } from '../src/contracts';
import { importContent } from '../src/modules/content';
import { openTestDatabase } from './db';
import { completeProfile, cookiesFrom, createSignedInUser, createTestApp, jsonRequest, signIn, signUp } from './auth';

const database = openTestDatabase();
const NOW = new Date('2026-11-16T12:00:00Z');
const { app, mailer } = createTestApp(database.db, { now: () => NOW });
const CONTENT_DIR = new URL('../content', import.meta.url).pathname;
afterAll(() => database.close());
beforeAll(() => importContent(database.db, CONTENT_DIR));

async function count(table: string, userId: string): Promise<number> {
  const result = await database.db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table} where user_id = '${userId.replace(/'/g, "''")}'`));
  return result.rows[0]!.n;
}

function deleteAccount(cookie: string, body: unknown = { confirm: 'DELETE' }) {
  return app.request('/api/v1/me', jsonRequest('DELETE', body, cookie));
}

function deleteWithoutBody(cookie: string) {
  return app.request('/api/v1/me', jsonRequest('DELETE', undefined, cookie));
}

describe('DELETE /api/v1/me (Story 1.7)', () => {
  it('requires a session and an explicit confirmation', async () => {
    expect((await deleteAccount('')).status).toBe(401);
    const cookie = await createSignedInUser(app, mailer, 'careful@example.com');
    for (const send of [() => deleteWithoutBody(cookie), () => deleteAccount(cookie, {}), () => deleteAccount(cookie, { confirm: 'yes' })]) {
      const res = await send();
      expect(res.status).toBe(400);
      expect(ProblemSchema.parse(await res.json()).code).toBe('accounts.confirmationRequired');
    }
    expect((await app.request('/api/v1/me', jsonRequest('GET', undefined, cookie))).status).toBe(200);
  });

  it("deletes the account and every module's rows, revokes all sessions and frees the Username", async () => {
    const cookie = await createSignedInUser(app, mailer, 'leaving@example.com');
    expect((await completeProfile(app, cookie, 'Leaving_Soon', 'cactus')).status).toBe(200);
    const me = MeResponseSchema.parse(await (await app.request('/api/v1/me', jsonRequest('GET', undefined, cookie))).json());
    // A second device: another cookie session and a bearer token.
    const second = await signIn(app, 'leaving@example.com');
    const otherCookie = cookiesFrom(second);
    const bearer = second.headers.get('set-auth-token')!;
    expect((await app.request('/api/v1/daily/2026-11-16/answer', jsonRequest('POST', { selectedIndex: 0, playedOn: '2026-11-16' }, cookie))).status).toBe(200);
    expect(await count('kno_daily.answer', me.id)).toBe(1);
    // Confirmation link, first sign-in and the second device.
    expect(await count('kno_accounts.session', me.id)).toBe(3);

    const res = await deleteAccount(cookie);
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().join('\n')).toMatch(/kno\.session_token=;.*Max-Age=0/i);

    for (const table of ['kno_daily.answer', 'kno_accounts.session', 'kno_accounts.account']) expect(await count(table, me.id)).toBe(0);
    const users = await database.db.execute<{ n: number }>(sql`select count(*)::int as n from kno_accounts."user" where id = ${me.id}`);
    expect(users.rows[0]!.n).toBe(0);

    for (const headers of [{ Cookie: cookie }, { Cookie: otherCookie }, { Authorization: `Bearer ${bearer}` }] as Record<string, string>[]) {
      expect((await app.request('/api/v1/me', { headers })).status).toBe(401);
    }
    expect((await signIn(app, 'leaving@example.com')).status).toBe(401);

    // The Username and the email are free again.
    const newcomer = await createSignedInUser(app, mailer, 'newcomer@example.com');
    expect((await completeProfile(app, newcomer, 'leaving_soon')).status).toBe(200);
    expect((await signUp(app, 'leaving@example.com')).status).toBe(200);
  });

  it("leaves other players' data alone", async () => {
    const stay = await createSignedInUser(app, mailer, 'stay@example.com');
    const go = await createSignedInUser(app, mailer, 'go@example.com');
    const stayer = MeResponseSchema.parse(await (await app.request('/api/v1/me', jsonRequest('GET', undefined, stay))).json());
    await app.request('/api/v1/daily/2026-11-16/answer', jsonRequest('POST', { selectedIndex: 1, playedOn: '2026-11-16' }, stay));
    await app.request('/api/v1/daily/2026-11-16/answer', jsonRequest('POST', { selectedIndex: 1, playedOn: '2026-11-16' }, go));

    expect((await deleteAccount(go)).status).toBe(204);
    expect(await count('kno_daily.answer', stayer.id)).toBe(1);
    expect((await app.request('/api/v1/me', jsonRequest('GET', undefined, stay))).status).toBe(200);
  });
});

describe('deleteAccount transaction', () => {
  it('keeps the account when a module fails to delete its rows', async () => {
    const { createAccounts, createDevMailer } = await import('../src/modules/accounts');
    const cookie = await createSignedInUser(app, mailer, 'kept@example.com');
    const me = MeResponseSchema.parse(await (await app.request('/api/v1/me', jsonRequest('GET', undefined, cookie))).json());
    const failing = createAccounts(
      database.db,
      { baseURL: 'http://localhost:5180', secret: 'kno-dev-secret-not-for-production-use-0000', mailer: createDevMailer(), rateLimit: false },
      undefined,
      [
        async (tx, userId) => {
          await tx.execute(sql`delete from kno_daily.answer where user_id = ${userId}`);
          throw new Error('module failed');
        },
      ],
    );
    await expect(failing.service.deleteAccount(me.id)).rejects.toThrow('module failed');
    expect((await app.request('/api/v1/me', jsonRequest('GET', undefined, cookie))).status).toBe(200);
  });
});

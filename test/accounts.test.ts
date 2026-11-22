import { afterAll, describe, expect, it } from 'vitest';
import { AuthProvidersResponseSchema, MeResponseSchema, ProblemSchema } from '@general-quiz/contracts';
import { isUsernameAllowed, isValidUsername } from '../src/modules/accounts';
import { openTestDatabase } from './db';
import {
  PASSWORD,
  completeProfile,
  confirmLastMail,
  cookiesFrom,
  createSignedInUser,
  createTestApp,
  jsonRequest,
  signIn,
  signUp,
} from './auth';

const database = openTestDatabase();
const { app, mailer } = createTestApp(database.db);
afterAll(() => database.close());

async function me(cookie?: string) {
  return app.request('/api/v1/me', jsonRequest('GET', undefined, cookie));
}

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toBe('application/problem+json');
  expect(ProblemSchema.parse(await res.json()).code).toBe(code);
}

describe('email sign-up and sign-in (Story 1.3)', () => {
  it('refuses a wrong confirmation code', async () => {
    await signUp(app, 'wrongcode@example.com');
    const wrong = mailer.lastMail!.code === '000000' ? '111111' : '000000';
    const res = await app.request('/api/auth/email-otp/verify-email', jsonRequest('POST', { email: 'wrongcode@example.com', otp: wrong }));
    expect(res.status).toBe(400);
    expect(cookiesFrom(res)).not.toMatch(/session_token/);
  });

  it('uses the fixed test code without sending any email when testCode is set', async () => {
    const { app: testApp, mailer: quiet } = createTestApp(database.db, { auth: { testCode: '490909' } });
    await signUp(testApp, 'tester@example.com');
    expect(quiet.sent).toHaveLength(0);
    const res = await testApp.request('/api/auth/email-otp/verify-email', jsonRequest('POST', { email: 'tester@example.com', otp: '490909' }));
    expect(res.status).toBe(200);
    expect(cookiesFrom(res)).toMatch(/kno\.session_token=/);
  });

  it('sends a confirmation email and refuses sign-in until it is confirmed', async () => {
    const res = await signUp(app, 'ada@example.com');
    expect(res.status).toBe(200);
    expect(cookiesFrom(res)).not.toMatch(/session_token/);
    expect(mailer.lastMail).toMatchObject({ kind: 'verifyCode', to: 'ada@example.com' });
    expect(mailer.lastMail!.code).toMatch(/^\d{6}$/);
    expect(mailer.lastMail!.text).toContain(mailer.lastMail!.code);

    const refused = await signIn(app, 'ada@example.com');
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('EMAIL_NOT_VERIFIED');

    const confirmed = await confirmLastMail(app, mailer);
    expect(confirmed).toMatch(/kno\.session_token=/);
    const signedIn = await signIn(app, 'ada@example.com');
    expect(signedIn.status).toBe(200);
    expect(cookiesFrom(signedIn)).toMatch(/kno\.session_token=/);
  });

  it('rejects a wrong password', async () => {
    const res = await signIn(app, 'ada@example.com', 'not-the-password');
    expect(res.status).toBe(401);
  });

  it('keeps a player signed in with the session cookie, and Sign out ends the session', async () => {
    const cookie = await createSignedInUser(app, mailer, 'grace@example.com');
    const first = MeResponseSchema.parse(await (await me(cookie)).json());
    expect(first).toMatchObject({ email: 'grace@example.com', username: null, avatar: null, profileComplete: false });
    // A later visit with the same cookie is still signed in.
    expect((await me(cookie)).status).toBe(200);

    const out = await app.request('/api/auth/sign-out', jsonRequest('POST', {}, cookie));
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().join('\n')).toMatch(/kno\.session_token=;.*Max-Age=0/i);
    await expectProblem(await me(cookie), 401, 'accounts.unauthorized');
  });

  it('accepts a bearer token for the future mobile client', async () => {
    const res = await signIn(app, 'ada@example.com');
    const token = res.headers.get('set-auth-token');
    expect(token).toBeTruthy();
    const viaBearer = await app.request('/api/v1/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(viaBearer.status).toBe(200);
  });

  it('returns 401 problem+json without a session', async () => {
    await expectProblem(await me(), 401, 'accounts.unauthorized');
    await expectProblem(await completeProfile(app, '', 'nobody'), 401, 'accounts.unauthorized');
  });
});

describe('Username and avatar step (Story 1.3)', () => {
  it('stores the Username and avatar and completes the profile', async () => {
    const cookie = await createSignedInUser(app, mailer, 'linus@example.com');
    const res = await completeProfile(app, cookie, 'Linus_T', 'robot');
    expect(res.status).toBe(200);
    expect(MeResponseSchema.parse(await res.json())).toMatchObject({ username: 'Linus_T', avatar: 'robot', profileComplete: true });
    expect(MeResponseSchema.parse(await (await me(cookie)).json()).profileComplete).toBe(true);
  });

  it('rejects a taken Username case-insensitively, but lets the owner keep or re-case it', async () => {
    const cookie = await createSignedInUser(app, mailer, 'other@example.com');
    await expectProblem(await completeProfile(app, cookie, 'linus_t'), 409, 'accounts.usernameTaken');
    await expectProblem(await completeProfile(app, cookie, 'LINUS_T'), 409, 'accounts.usernameTaken');

    const owner = cookiesFrom(await signIn(app, 'linus@example.com'));
    expect((await completeProfile(app, owner, 'linus_T', 'fox')).status).toBe(200);
  });

  it('rejects offensive and reserved Usernames with a clear message', async () => {
    const cookie = await createSignedInUser(app, mailer, 'rude@example.com');
    for (const name of ['fuck_you', 'Sh1t_head', 'admin', 'nazi_99']) {
      const res = await completeProfile(app, cookie, name);
      expect(res.status).toBe(422);
      const body = ProblemSchema.parse(await res.json());
      expect(body.code).toBe('accounts.usernameNotAllowed');
      expect(body.detail).toMatch(/not allowed/);
    }
  });

  it('validates the Username format and the avatar id', async () => {
    const cookie = cookiesFrom(await signIn(app, 'rude@example.com'));
    for (const body of [
      { username: 'ab', avatar: 'owl' },
      { username: 'a'.repeat(21), avatar: 'owl' },
      { username: 'has space', avatar: 'owl' },
      { username: 'émile', avatar: 'owl' },
      { username: 'valid_name', avatar: 'dragon' },
    ]) {
      await expectProblem(await app.request('/api/v1/me/profile', jsonRequest('PUT', body, cookie)), 400, 'accounts.invalidProfile');
    }
  });

  it('refuses an offensive Username sent straight to Better Auth at sign-up', async () => {
    const res = await app.request(
      '/api/auth/sign-up/email',
      jsonRequest('POST', { name: '', email: 'sneaky@example.com', password: PASSWORD, username: 'fuck_it', callbackURL: '/' }),
    );
    expect(res.status).toBe(400);
  });
});

describe('username rules', () => {
  it('blocks offensive words in disguise but not harmless names that contain them', () => {
    for (const bad of ['f_u_c_k', 'B1TCH', 'rape', 'my_porn', 'support', 'KNO']) expect(isUsernameAllowed(bad)).toBe(false);
    for (const ok of ['grape_fan', 'peacock', 'nazim', 'dickens_reader', 'scout_42']) expect(isUsernameAllowed(ok)).toBe(true);
    expect(isValidUsername('ok_name')).toBe(true);
    expect(isValidUsername('no')).toBe(false);
  });
});

describe('providers', () => {
  it('reports Google as unavailable when it is not configured', async () => {
    const res = await app.request('/api/v1/auth/providers');
    expect(AuthProvidersResponseSchema.parse(await res.json())).toEqual({ google: false });
  });
});

describe('rate limiting', () => {
  it('limits repeated sign-in attempts from one client', async () => {
    const limited = createTestApp(database.db, { auth: { rateLimit: true } }).app;
    const attempt = () =>
      limited.request('/api/auth/sign-in/email', {
        ...jsonRequest('POST', { email: 'ada@example.com', password: 'wrong-password' }),
        headers: { ...(jsonRequest('POST', {}).headers as Record<string, string>), 'X-Forwarded-For': '203.0.113.7' },
      });
    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.at(-1)).toBe(429);
  });
});

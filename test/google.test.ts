import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvidersResponseSchema, MeResponseSchema } from '../src/contracts';
import { openTestDatabase } from './db';
import { ORIGIN, completeProfile, cookiesFrom, createSignedInUser, createTestApp, jsonRequest, signUp } from './auth';

const database = openTestDatabase();
const google = { clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-secret' };
const { app, mailer } = createTestApp(database.db, { auth: { google } });
afterAll(() => database.close());
afterEach(() => vi.unstubAllGlobals());

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** An ID token as Google's token endpoint returns it (the callback decodes it; the TLS exchange vouches for it). */
function idToken(claims: { sub: string; email: string; email_verified: boolean; name?: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: 'https://accounts.google.com', aud: google.clientId, iat: now, exp: now + 3600, name: 'Google Player', ...claims };
  return `${base64url({ alg: 'RS256', typ: 'JWT', kid: 'test' })}.${base64url(payload)}.signature`;
}

/** Runs the whole redirect flow with Google's token endpoint stubbed; returns the callback response. */
async function signInWithGoogle(claims: Parameters<typeof idToken>[0], callbackURL = '/#today') {
  const start = await app.request('/api/auth/sign-in/social', jsonRequest('POST', { provider: 'google', callbackURL }));
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const authorize = new URL(url);
  expect(authorize.origin).toBe('https://accounts.google.com');
  expect(authorize.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback/google`);
  const state = authorize.searchParams.get('state')!;

  const realFetch = globalThis.fetch;
  const tokenCalls: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (target.startsWith('https://oauth2.googleapis.com/token')) {
      tokenCalls.push(target);
      return new Response(JSON.stringify({ access_token: 'access', id_token: idToken(claims), expires_in: 3600, token_type: 'Bearer', scope: 'openid email profile' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return realFetch(input, init);
  });
  const callback = await app.request(`/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state)}`, {
    headers: { Cookie: cookiesFrom(start), Origin: ORIGIN },
  });
  vi.unstubAllGlobals();
  expect(tokenCalls).toHaveLength(1);
  return callback;
}

async function me(cookie: string) {
  return MeResponseSchema.parse(await (await app.request('/api/v1/me', jsonRequest('GET', undefined, cookie))).json());
}

describe('Sign in with Google (Story 1.4)', () => {
  it('reports Google as available when it is configured', async () => {
    const res = await app.request('/api/v1/auth/providers');
    expect(AuthProvidersResponseSchema.parse(await res.json())).toEqual({ google: true });
  });

  it('creates a session like email sign-in and sends a first-time player to the profile step', async () => {
    const callback = await signInWithGoogle({ sub: 'g-1', email: 'newcomer@gmail.com', email_verified: true });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/#today');
    const cookie = cookiesFrom(callback);
    expect(cookie).toMatch(/kno\.session_token=/);

    expect(await me(cookie)).toMatchObject({ email: 'newcomer@gmail.com', username: null, avatar: null, profileComplete: false });
    expect((await completeProfile(app, cookie, 'Newcomer', 'cat')).status).toBe(200);
    expect((await me(cookie)).profileComplete).toBe(true);
  });

  it('signs a returning Google player into the same account', async () => {
    const callback = await signInWithGoogle({ sub: 'g-1', email: 'newcomer@gmail.com', email_verified: true });
    expect(await me(cookiesFrom(callback))).toMatchObject({ username: 'Newcomer', profileComplete: true });
  });

  it('joins a confirmed email account with the same email instead of creating a duplicate', async () => {
    const emailCookie = await createSignedInUser(app, mailer, 'both@example.com');
    expect((await completeProfile(app, emailCookie, 'BothWays', 'fox')).status).toBe(200);
    const emailUser = await me(emailCookie);

    const callback = await signInWithGoogle({ sub: 'g-2', email: 'both@example.com', email_verified: true });
    expect(callback.status).toBe(302);
    const viaGoogle = await me(cookiesFrom(callback));
    expect(viaGoogle.id).toBe(emailUser.id);
    expect(viaGoogle.username).toBe('BothWays');
  });

  it('does not take over an unconfirmed email account', async () => {
    expect((await signUp(app, 'unconfirmed@example.com')).status).toBe(200);
    const callback = await signInWithGoogle({ sub: 'g-3', email: 'unconfirmed@example.com', email_verified: true });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toMatch(/error=account_not_linked/);
    expect(cookiesFrom(callback)).not.toMatch(/kno\.session_token=/);
  });
});

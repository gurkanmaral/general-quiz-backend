import { expect } from 'vitest';
import type { AvatarId } from '../src/contracts';
import { DEFAULT_AUTH_URL } from '../src/env';
import { createApp, type AppDeps } from '../src/http/app';
import { createLogger } from '../src/logger';
import { createDevMailer, type DevMailer } from '../src/modules/accounts';
import type { Db } from '../src/db/client';

export const ORIGIN = DEFAULT_AUTH_URL;
export const PASSWORD = 'correct-horse-9';

export type TestApp = ReturnType<typeof createApp>;

/** An app with a dev mailer the test can read and the auth rate limiter off unless asked for. */
export function createTestApp(db: Db, overrides: Partial<AppDeps> = {}): { app: TestApp; mailer: DevMailer } {
  const mailer = createDevMailer();
  const app = createApp({
    db,
    logger: createLogger('silent'),
    ...overrides,
    auth: { rateLimit: false, mailer, ...overrides.auth },
  });
  return { app, mailer };
}

/** A same-origin JSON request, as the web makes through the Vite proxy. */
export function jsonRequest(method: string, body?: unknown, cookie?: string): RequestInit {
  const headers: Record<string, string> = { Origin: ORIGIN, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  return { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
}

/** `name=value; name2=value2` from every Set-Cookie of a response (expired cookies dropped). */
export function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .filter((line) => !/max-age=0/i.test(line))
    .map((line) => line.split(';')[0])
    .join('; ');
}

export async function signUp(app: TestApp, email: string, password = PASSWORD): Promise<Response> {
  return app.request('/api/auth/sign-up/email', jsonRequest('POST', { name: '', email, password, callbackURL: '/' }));
}

/** Enters the code from the last mail; returns the session cookie it sets. */
export async function confirmLastMail(app: TestApp, mailer: DevMailer): Promise<string> {
  const mail = mailer.lastMail!;
  const res = await app.request('/api/auth/email-otp/verify-email', jsonRequest('POST', { email: mail.to, otp: mail.code }));
  expect(res.status).toBe(200);
  return cookiesFrom(res);
}

export async function signIn(app: TestApp, email: string, password = PASSWORD): Promise<Response> {
  return app.request('/api/auth/sign-in/email', jsonRequest('POST', { email, password, rememberMe: true }));
}

/** Sign up, confirm and sign in; returns the session cookie. */
export async function createSignedInUser(app: TestApp, mailer: DevMailer, email: string): Promise<string> {
  expect((await signUp(app, email)).status).toBe(200);
  await confirmLastMail(app, mailer);
  const res = await signIn(app, email);
  expect(res.status).toBe(200);
  return cookiesFrom(res);
}

export async function completeProfile(app: TestApp, cookie: string, username: string, avatar: AvatarId = 'owl'): Promise<Response> {
  return app.request('/api/v1/me/profile', jsonRequest('PUT', { username, avatar }, cookie));
}

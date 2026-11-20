import { Hono } from 'hono';
import { ACCOUNTS_PROBLEM_CODES, ProfileUpdateSchema, type AuthProvidersResponse } from '@general-quiz/contracts';
import { problem } from '../../http/problem';
import type { AccountsService } from './service';

/** `/api/v1/me`: the signed-in player's account and profile step. */
export function meRoutes(accounts: AccountsService) {
  return new Hono()
    .get('/', async (c) => {
      const signedIn = await accounts.requireUser(c);
      const me = await accounts.getMe(signedIn.id);
      if (!me) return problem(c, { status: 401, code: ACCOUNTS_PROBLEM_CODES.unauthorized, title: 'Sign in required' });
      return c.json(me);
    })
    .put('/profile', async (c) => {
      const signedIn = await accounts.requireUser(c);
      const body = ProfileUpdateSchema.safeParse(await c.req.json().catch(() => undefined));
      if (!body.success) {
        return problem(c, {
          status: 400,
          code: ACCOUNTS_PROBLEM_CODES.invalidProfile,
          title: 'Invalid profile',
          detail: body.error.issues[0]?.message ?? 'Pick a Username (3–20 letters, numbers or _) and an avatar.',
        });
      }
      const result = await accounts.updateProfile(signedIn.id, body.data);
      if (result.ok) return c.json(result.me);
      return result.reason === 'usernameTaken'
        ? problem(c, { status: 409, code: ACCOUNTS_PROBLEM_CODES.usernameTaken, title: 'Username taken', detail: 'That Username is already taken. Try another one.' })
        : problem(c, { status: 422, code: ACCOUNTS_PROBLEM_CODES.usernameNotAllowed, title: 'Username not allowed', detail: 'That Username is not allowed. Try another one.' });
    });
}

/** `/api/v1/auth/providers`: lets the web hide the Google button when Google is not configured. */
export function providerRoutes(providers: AuthProvidersResponse) {
  return new Hono().get('/providers', (c) => c.json(providers));
}

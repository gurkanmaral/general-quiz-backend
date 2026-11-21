// Public interface of the accounts module (AD-2). Other modules import only from here.
import type { Context } from 'hono';
import type { EquippedTitle } from '@general-quiz/contracts';
import type { Db } from '../../db/client';
import type { Logger } from '../../logger';
import { createAuth, type AuthConfig } from './auth';
import { meRoutes, providerRoutes } from './routes';
import { createAccountsService, type UserDataDeleter } from './service';

export { AUTH_BASE_PATH, type AuthConfig, type GoogleConfig } from './auth';
export { createDevMailer, createMailer, createResendMailer, type DevMailer, type Mail, type Mailer } from './mailer';
export { isUsernameAllowed, isValidUsername, normalizeUsername } from './usernames';
export type { AccountsService, PublicPlayer, SessionUser, UserDataDeleter } from './service';
/** For foreign keys to `kno_accounts.user.id` only (AD-2); never query it from another module. */
export { user as accountsUserTable } from './schema';

/** Lookups other modules plug into accounts without accounts depending on them (AD-2). */
export type AccountsHooks = {
  /** The player's equipped Title (from `progress`), shown with `/me` (FR-18). */
  equippedTitle?: (userId: string) => Promise<EquippedTitle | null>;
};

/** Builds Better Auth, the accounts service and its routes. */
export function createAccounts(
  db: Db,
  config: AuthConfig,
  logger?: Logger,
  userDataDeleters: readonly UserDataDeleter[] = [],
  hooks: AccountsHooks = {},
) {
  const auth = createAuth(db, config, logger);
  const service = createAccountsService(db, auth, userDataDeleters);
  return {
    auth,
    service,
    /** `requireUser(c)` for other modules' routes: the session user or a thrown 401 problem+json. */
    requireUser: service.requireUser,
    /** The session user, or undefined when signed out (for public routes with extra signed-in data). */
    optionalUser: (c: Context) => service.sessionUser(c.req.raw.headers),
    /** Mount at `AUTH_BASE_PATH`: Better Auth's own handler. */
    authHandler: (request: Request) => auth.handler(request),
    meRoutes: () => meRoutes(service, hooks),
    providerRoutes: () => providerRoutes({ google: Boolean(config.google) }),
  };
}
export type Accounts = ReturnType<typeof createAccounts>;

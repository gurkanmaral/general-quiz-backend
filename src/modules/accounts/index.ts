// Public interface of the accounts module (AD-2). Other modules import only from here.
import type { Db } from '../../db/client';
import type { Logger } from '../../logger';
import { createAuth, type AuthConfig } from './auth';
import { meRoutes, providerRoutes } from './routes';
import { createAccountsService } from './service';

export { AUTH_BASE_PATH, type AuthConfig, type GoogleConfig } from './auth';
export { createDevMailer, type DevMailer, type Mail, type Mailer } from './mailer';
export { isUsernameAllowed, isValidUsername, normalizeUsername } from './usernames';
export type { AccountsService, SessionUser } from './service';
/** For foreign keys to `kno_accounts.user.id` only (AD-2); never query it from another module. */
export { user as accountsUserTable } from './schema';

/** Builds Better Auth, the accounts service and its routes. */
export function createAccounts(db: Db, config: AuthConfig, logger?: Logger) {
  const auth = createAuth(db, config, logger);
  const service = createAccountsService(db, auth);
  return {
    auth,
    service,
    /** `requireUser(c)` for other modules' routes: the session user or a thrown 401 problem+json. */
    requireUser: service.requireUser,
    /** Mount at `AUTH_BASE_PATH`: Better Auth's own handler. */
    authHandler: (request: Request) => auth.handler(request),
    meRoutes: () => meRoutes(service),
    providerRoutes: () => providerRoutes({ google: Boolean(config.google) }),
  };
}
export type Accounts = ReturnType<typeof createAccounts>;

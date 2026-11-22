import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins/bearer';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { username } from 'better-auth/plugins/username';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from '../../contracts';
import type { Db } from '../../db/client';
import type { Logger } from '../../logger';
import type { Mailer } from './mailer';
import * as schema from './schema';
import { isValidUsername, normalizeUsername } from './usernames';

export type GoogleConfig = { clientId: string; clientSecret: string };

export type AuthConfig = {
  /** Public origin of the web app, which reaches `/api/auth` on the same origin (AD-12). */
  baseURL: string;
  secret: string;
  /** Extra origins allowed to call the auth endpoints (e.g. a second local dev port). */
  trustedOrigins?: readonly string[];
  google?: GoogleConfig;
  mailer: Mailer;
  /** Better Auth's built-in limiter (on by default); tests turn it off to sign in freely. */
  rateLimit?: boolean;
  /** Reverse-proxy IPs/CIDRs whose X-Forwarded-For hops are skipped to find the client IP (TRUST_PROXY). */
  trustedProxies?: readonly string[];
  /**
   * Development/testing only: every confirmation code is this value and no email is sent.
   * Never set in production (env validation refuses AUTH_TEST_CODE there).
   */
  testCode?: string;
};

export const AUTH_BASE_PATH = '/api/auth';
/** Sessions last 60 days and slide forward once a day while the player keeps coming back. */
const SESSION_EXPIRES_IN_S = 60 * 24 * 60 * 60;
const SESSION_UPDATE_AGE_S = 24 * 60 * 60;

export function createAuth(db: Db, config: AuthConfig, logger?: Logger) {
  return betterAuth({
    appName: 'KNO.',
    baseURL: config.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: config.secret,
    trustedOrigins: [config.baseURL, ...(config.trustedOrigins ?? [])],
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    logger: {
      level: 'warn',
      log: (level, message) => logger?.[level]({ source: 'better-auth' }, message),
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: false,
    },
    // Email is confirmed with a 6-digit code (email-OTP plugin below), which also signs the player in.
    // A sign-in attempt on an unconfirmed account sends a fresh code, so the code screen always has one.
    emailVerification: { sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: true },
    socialProviders: config.google
      ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret, prompt: 'select_account' } }
      : {},
    // A Google sign-in with the same verified email joins the existing confirmed account (Story 1.4).
    // Better Auth links only when Google says the email is verified and the local email is confirmed.
    account: { accountLinking: { enabled: true } },
    user: {
      additionalFields: {
        avatar: { type: 'string', required: false, input: false },
      },
    },
    session: { expiresIn: SESSION_EXPIRES_IN_S, updateAge: SESSION_UPDATE_AGE_S },
    rateLimit: { enabled: config.rateLimit ?? true, storage: 'memory' },
    advanced: {
      cookiePrefix: 'kno',
      // The client IP feeds the auth rate limiter; behind a proxy only its forwarded chain is trusted.
      ipAddress: config.trustedProxies?.length ? { ipAddressHeaders: ['x-forwarded-for'], trustedProxies: [...config.trustedProxies] } : undefined,
    },
    telemetry: { enabled: false },
    plugins: [
      username({
        minUsernameLength: USERNAME_MIN_LENGTH,
        maxUsernameLength: USERNAME_MAX_LENGTH,
        usernameValidator: isValidUsername,
        usernameNormalization: normalizeUsername,
      }),
      // Bearer tokens for the future React Native client (AD-12).
      bearer(),
      emailOTP({
        overrideDefaultEmailVerification: true,
        sendVerificationOnSignUp: true,
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 5,
        // Spread, not `generateOTP: undefined`: the plugin's default generator must survive when no test code is set.
        ...(config.testCode ? { generateOTP: () => config.testCode } : {}),
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== 'email-verification') return;
          if (config.testCode) {
            logger?.info({ kind: 'verifyCode' }, `test mode: no email sent, use code ${config.testCode}`);
            return;
          }
          await config.mailer.send({
            kind: 'verifyCode',
            to: email,
            subject: `${otp} is your KNO. code`,
            text: `Welcome to KNO.!\n\nYour confirmation code is ${otp}. It expires in 10 minutes.\n\nIf you did not sign up, ignore this email.`,
            code: otp,
          });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

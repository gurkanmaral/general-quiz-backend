import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Local dev default, so a fresh clone runs without a `.env`; production must set DATABASE_URL. */
export const DEFAULT_DATABASE_URL = 'postgres://postgres@localhost:5432/kno';
export const DEFAULT_CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));
/** The built web app (`apps/web/dist`), served by the API in production. Same depth from src/ and dist/. */
export const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));

/** The Vite dev server (same origin as the API through its `/api` proxy). */
export const DEFAULT_AUTH_URL = 'http://localhost:5180';
/** Development-only signing secret; production must set BETTER_AUTH_SECRET. */
/** Email confirmation code used in development when AUTH_TEST_CODE is not set; no email is sent. */
export const DEV_TEST_CODE = '490909';
export const DEV_AUTH_SECRET = 'kno-dev-secret-not-for-production-use-0000';

/** An unset or empty variable (`GOOGLE_CLIENT_ID=` in .env) means "not configured". */
const optionalText = z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CONTENT_DIR: z.string().min(1).default(DEFAULT_CONTENT_DIR),
  /** Public origin of the web app; Better Auth builds links and checks origins against it (AD-12). */
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }).default(DEFAULT_AUTH_URL),
  /** Signs session cookies; at least 32 characters. Required in production. */
  BETTER_AUTH_SECRET: z.string().min(32).default(DEV_AUTH_SECRET),
  /** Google sign-in is offered only when both are set (Story 1.4). */
  GOOGLE_CLIENT_ID: optionalText,
  GOOGLE_CLIENT_SECRET: optionalText,
  /** Sends sign-in emails through Resend when set; otherwise links are only logged (dev). */
  RESEND_API_KEY: optionalText,
  MAIL_FROM: z.string().min(3).default('KNO. <no-reply@kno.example>'),
  /** Serve the built web app from this folder; defaults to apps/web/dist in production. */
  WEB_DIR: optionalText,
  /** Run migrations and `kno import` on start (behind an advisory lock); defaults to on in production. */
  IMPORT_ON_START: z.enum(['true', 'false']).optional(),
  /** Development/testing: fixed 6-digit email code and no emails sent. Defaults to 490909 outside production; refused in production. */
  AUTH_TEST_CODE: z.string().regex(/^\d{6}$/).optional(),
  /** Comma-separated reverse-proxy IPs/CIDRs in front of the API (Better Auth's trusted proxies). */
  TRUST_PROXY: z.preprocess(
    (value) => (typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : []),
    z.array(z.string().min(1)),
  ),
});
export type Env = z.infer<typeof EnvSchema>;

/** Validates configuration once; throws a readable error listing every bad variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const withDefaults =
    source.NODE_ENV === 'production' || source.DATABASE_URL ? source : { ...source, DATABASE_URL: DEFAULT_DATABASE_URL };
  const result = EnvSchema.superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.BETTER_AUTH_SECRET === DEV_AUTH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['BETTER_AUTH_SECRET'], message: 'must be set in production' });
    }
    if (env.AUTH_TEST_CODE) {
      ctx.addIssue({ code: 'custom', path: ['AUTH_TEST_CODE'], message: 'must not be set in production' });
    }
  }).safeParse(withDefaults);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Reads `apps/api/.env` (if present) into process.env, then validates. Variables already set win. */
export function loadEnv(): Env {
  if (cached) return cached;
  const file = `${API_ROOT}.env`;
  if (existsSync(file)) process.loadEnvFile(file);
  cached = parseEnv(process.env);
  return cached;
}

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Local dev default, so a fresh clone runs without a `.env`; production must set DATABASE_URL. */
export const DEFAULT_DATABASE_URL = 'postgres://postgres@localhost:5432/kno';
export const DEFAULT_CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));

/** The Vite dev server (same origin as the API through its `/api` proxy). */
export const DEFAULT_AUTH_URL = 'http://localhost:5180';
/** Development-only signing secret; production must set BETTER_AUTH_SECRET. */
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

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Local dev default, so a fresh clone runs without a `.env`; production must set DATABASE_URL. */
export const DEFAULT_DATABASE_URL = 'postgres://postgres@localhost:5432/kno';
export const DEFAULT_CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CONTENT_DIR: z.string().min(1).default(DEFAULT_CONTENT_DIR),
});
export type Env = z.infer<typeof EnvSchema>;

/** Validates configuration once; throws a readable error listing every bad variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const withDefaults =
    source.NODE_ENV === 'production' || source.DATABASE_URL ? source : { ...source, DATABASE_URL: DEFAULT_DATABASE_URL };
  const result = EnvSchema.safeParse(withDefaults);
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

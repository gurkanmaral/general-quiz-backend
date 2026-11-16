import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT_DIR, parseEnv } from '../src/env';

describe('env', () => {
  it('applies defaults to a minimal environment', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://postgres@localhost:5432/kno' });
    expect(env).toMatchObject({ PORT: 8787, LOG_LEVEL: 'info', NODE_ENV: 'development', CONTENT_DIR: DEFAULT_CONTENT_DIR });
    expect(DEFAULT_CONTENT_DIR).toMatch(/content$/);
  });

  it('coerces PORT and lists every invalid variable', () => {
    expect(parseEnv({ DATABASE_URL: 'postgresql://db/kno', PORT: '9000' }).PORT).toBe(9000);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://db', PORT: 'abc' })).toThrow(/DATABASE_URL[\s\S]*PORT/);
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });
});

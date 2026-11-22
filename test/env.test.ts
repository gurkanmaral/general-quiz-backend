import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT_DIR, DEFAULT_DATABASE_URL, parseEnv } from '../src/env';

describe('env', () => {
  it('applies defaults to a minimal environment', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://postgres@localhost:5432/kno' });
    expect(env).toMatchObject({ PORT: 8787, LOG_LEVEL: 'info', NODE_ENV: 'development', CONTENT_DIR: DEFAULT_CONTENT_DIR });
    expect(DEFAULT_CONTENT_DIR).toMatch(/content$/);
  });

  it('coerces PORT and lists every invalid variable', () => {
    expect(parseEnv({ DATABASE_URL: 'postgresql://db/kno', PORT: '9000' }).PORT).toBe(9000);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://db', PORT: 'abc' })).toThrow(/DATABASE_URL[\s\S]*PORT/);
  });

  it('defaults DATABASE_URL to the local dev database outside production only', () => {
    expect(parseEnv({}).DATABASE_URL).toBe(DEFAULT_DATABASE_URL);
    expect(DEFAULT_DATABASE_URL).toBe('postgres://postgres@localhost:5432/kno');
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });

  it('requires a real auth secret in production and treats empty Google settings as unset', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://db/kno' };
    expect(() => parseEnv(base)).toThrow(/BETTER_AUTH_SECRET/);
    const env = parseEnv({ ...base, BETTER_AUTH_SECRET: 'x'.repeat(32), GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.BETTER_AUTH_URL).toBe('http://localhost:5180');
  });

  it('accepts a 6-digit AUTH_TEST_CODE in development but refuses it in production', () => {
    expect(parseEnv({ AUTH_TEST_CODE: '490909' }).AUTH_TEST_CODE).toBe('490909');
    expect(() => parseEnv({ AUTH_TEST_CODE: '12ab' })).toThrow(/AUTH_TEST_CODE/);
    const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://db/kno', BETTER_AUTH_SECRET: 'x'.repeat(32) };
    expect(() => parseEnv({ ...prod, AUTH_TEST_CODE: '490909' })).toThrow(/AUTH_TEST_CODE: must not be set in production/);
  });

  it('reads TRUST_PROXY as a comma-separated list of proxy addresses', () => {
    expect(parseEnv({}).TRUST_PROXY).toEqual([]);
    expect(parseEnv({ TRUST_PROXY: ' 10.0.0.1, 192.0.2.0/24 ,' }).TRUST_PROXY).toEqual(['10.0.0.1', '192.0.2.0/24']);
  });
});

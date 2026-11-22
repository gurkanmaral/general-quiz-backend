import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// API tests hit a real Postgres (spine: Tests). Global setup and workers both read this:
// .env first (variables already set win), then the local default.
const envFile = new URL('./.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.DATABASE_URL_TEST ??= 'postgres://postgres@localhost:5432/kno_test';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/globalSetup.ts'],
    setupFiles: ['./test/setup.ts'],
    // One shared test database: files run one at a time and truncate before they start.
    fileParallelism: false,
    env: { NODE_ENV: 'test' },
  },
});

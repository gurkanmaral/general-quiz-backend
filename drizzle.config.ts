import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  casing: 'snake_case',
  schemaFilter: ['kno_accounts', 'kno_quizzes', 'kno_daily', 'kno_progress', 'kno_social', 'kno_lobbies', 'kno_content'],
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/kno' },
});

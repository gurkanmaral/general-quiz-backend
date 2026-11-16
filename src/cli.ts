import { createDatabase, runMigrations } from './db/client';
import { loadEnv } from './env';
import { countChanges, importContent } from './modules/content';

const USAGE = `Usage: npm run kno -- <command>

Commands:
  import [--dir <path>]  apply migrations, then upsert published content from content/ (default CONTENT_DIR)
  migrate                apply database migrations only`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'import' && command !== 'migrate') {
    console.error(USAGE);
    return command === undefined || command === '--help' ? 0 : 1;
  }
  const env = loadEnv();
  const database = createDatabase(env.DATABASE_URL);
  try {
    await runMigrations(database.db);
    if (command === 'migrate') {
      console.log('Migrations applied.');
      return 0;
    }
    const dirFlag = rest.indexOf('--dir');
    const dir = dirFlag >= 0 && rest[dirFlag + 1] ? rest[dirFlag + 1]! : env.CONTENT_DIR;
    const report = await importContent(database.db, dir);
    console.log(`Imported content from ${dir}`);
    console.log(`  quizzes:   ${report.quizzes.written} written, ${report.quizzes.unpublished} unpublished`);
    console.log(`  questions: ${report.questions.written} written, ${report.questions.unpublished} unpublished`);
    console.log(`  rotation:  ${report.rotation.written} written, ${report.rotation.removed} removed`);
    console.log(`  schedule:  ${report.entries.written} entries written`);
    console.log(`  pending items skipped: ${report.skippedPending}`);
    console.log(countChanges(report) === 0 ? 'No changes.' : `${countChanges(report)} changes.`);
    return 0;
  } finally {
    await database.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  },
);

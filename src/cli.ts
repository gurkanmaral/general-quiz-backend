import { parseArgs } from './cliArgs';
import { createDatabase, runMigrations } from './db/client';
import { loadEnv } from './env';
import { countChanges, importContent, listOpenReports, resolveReports } from './modules/content';

const USAGE = `Usage: npm run kno -- <command>

Commands:
  import [--dir <path>]  apply migrations, then upsert published content from content/ (default CONTENT_DIR)
  migrate                apply database migrations only
  reports                list open reports of wrong Questions, grouped by Question
  reports resolve <id>   close one report by id (or every open report of a Question by its slug)`;

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, process.env.INIT_CWD ?? process.cwd());
  if (args.command === 'help' || args.command === 'usageError') {
    console.error(USAGE);
    return args.command === 'help' ? 0 : 1;
  }
  const env = loadEnv();
  const database = createDatabase(env.DATABASE_URL);
  try {
    await runMigrations(database.db);
    if (args.command === 'migrate') {
      console.log('Migrations applied.');
      return 0;
    }
    if (args.command === 'reports') {
      const groups = await listOpenReports(database.db);
      if (groups.length === 0) console.log('No open reports.');
      for (const group of groups) {
        console.log(`${group.questionSlug}  (${group.reports.length} open)`);
        for (const item of group.reports) {
          console.log(`  ${item.id}  ${item.createdAt.toISOString().slice(0, 16).replace('T', ' ')}  ${item.source}${item.note ? `  "${item.note}"` : ''}`);
        }
      }
      return 0;
    }
    if (args.command === 'resolveReport') {
      const count = await resolveReports(database.db, args.id, new Date());
      console.log(count === 0 ? `No open report matches ${args.id}.` : `Resolved ${count} report${count === 1 ? '' : 's'}.`);
      return count === 0 ? 1 : 0;
    }
    const dir = args.dir ?? env.CONTENT_DIR;
    const report = await importContent(database.db, dir);
    console.log(`Imported content from ${dir}`);
    console.log(`  quizzes:   ${report.quizzes.written} written, ${report.quizzes.unpublished} unpublished`);
    console.log(`  questions: ${report.questions.written} written, ${report.questions.unpublished} unpublished`);
    console.log(`  badges/titles: ${report.awards.written} written, ${report.awards.unpublished} unpublished`);
    console.log(`  rotation:  ${report.rotation.written} written, ${report.rotation.removed} removed`);
    console.log(`  schedule:  ${report.entries.written} entries written, ${report.entries.removed} removed`);
    console.log(`  pending items skipped: ${report.skippedPending}`);
    for (const item of report.pending) console.log(`    - ${item}`);
    for (const warning of report.warnings) console.warn(`WARNING: ${warning}`);
    console.log(countChanges(report) === 0 ? 'No changes.' : `${countChanges(report)} changes.`);
    return 0;
  } finally {
    await database.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);

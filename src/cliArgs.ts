import { resolve } from 'node:path';

export type CliCommand = { command: 'import'; dir?: string } | { command: 'migrate' } | { command: 'help' } | { command: 'usageError' };

/** Parses CLI arguments; `--dir` is resolved against the directory npm was started from. */
export function parseArgs(argv: readonly string[], cwd: string): CliCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help') return { command: 'help' };
  if (command === 'migrate' && rest.length === 0) return { command: 'migrate' };
  if (command !== 'import') return { command: 'usageError' };
  if (rest.length === 0) return { command: 'import' };
  const [flag, value, ...extra] = rest;
  if (flag !== '--dir' || !value || value.startsWith('--') || extra.length) return { command: 'usageError' };
  return { command: 'import', dir: resolve(cwd, value) };
}

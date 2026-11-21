import { resolve } from 'node:path';

export type CliCommand =
  | { command: 'import'; dir?: string }
  | { command: 'migrate' }
  | { command: 'reports' }
  | { command: 'resolveReport'; id: string }
  | { command: 'help' } | { command: 'usageError' };

/** Parses CLI arguments; `--dir` is resolved against the directory npm was started from. */
export function parseArgs(argv: readonly string[], cwd: string): CliCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help') return { command: 'help' };
  if (command === 'migrate' && rest.length === 0) return { command: 'migrate' };
  if (command === 'reports') {
    if (rest.length === 0) return { command: 'reports' };
    if (rest.length === 2 && rest[0] === 'resolve' && rest[1] && !rest[1].startsWith('--')) return { command: 'resolveReport', id: rest[1] };
    return { command: 'usageError' };
  }
  if (command !== 'import') return { command: 'usageError' };
  if (rest.length === 0) return { command: 'import' };
  const [flag, value, ...extra] = rest;
  if (flag !== '--dir' || !value || value.startsWith('--') || extra.length) return { command: 'usageError' };
  return { command: 'import', dir: resolve(cwd, value) };
}

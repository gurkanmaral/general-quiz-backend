import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cliArgs';

describe('kno CLI arguments', () => {
  it('resolves --dir against the directory npm was started from', () => {
    expect(parseArgs(['import', '--dir', 'content'], '/repo')).toEqual({ command: 'import', dir: '/repo/content' });
    expect(parseArgs(['import', '--dir', '/abs/content'], '/repo')).toEqual({ command: 'import', dir: '/abs/content' });
    expect(parseArgs(['import'], '/repo')).toEqual({ command: 'import' });
    expect(parseArgs(['migrate'], '/repo')).toEqual({ command: 'migrate' });
    expect(parseArgs(['reports'], '/repo')).toEqual({ command: 'reports' });
    expect(parseArgs(['reports', 'resolve', 'abc'], '/repo')).toEqual({ command: 'resolveReport', id: 'abc' });
  });

  it('treats --dir without a value and unknown input as usage errors', () => {
    for (const argv of [['import', '--dir'], ['import', '--dir', '--other'], ['import', 'content'], ['nope'], ['migrate', 'x'], ['reports', 'resolve'], ['reports', 'x'], ['reports', 'resolve', 'a', 'b']]) {
      expect(parseArgs(argv, '/repo')).toEqual({ command: 'usageError' });
    }
    expect(parseArgs([], '/repo')).toEqual({ command: 'help' });
  });
});

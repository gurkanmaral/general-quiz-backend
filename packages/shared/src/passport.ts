import { getCountry } from './countries';
import type { Progress } from './progress';
import { poolFor, type Region } from './regions';
import type { AnsweredCountry } from './round';

/**
 * Flag Passport (FR-17, FR-18). Every answered Question in any Game Mode, Direction
 * or Difficulty (the Daily Challenge and quit Rounds included) counts for its answer
 * country. Collected = at least 1 correct answer, Mastered = at least 3.
 */

export type PassportEntry = {
  /** Correct answers for this country. Wrong answers never reduce it. */
  correct: number;
  /** Times this country was the answer. */
  seen: number;
};

export type Passport = Record<string, PassportEntry>;

export type PassportState = 'none' | 'collected' | 'mastered';

/** Correct answers needed to collect a country. */
export const COLLECTED_AT = 1;
/** Correct answers needed to master a country. */
export const MASTERED_AT = 3;

export function stateOf(entry: PassportEntry | undefined): PassportState {
  const correct = entry?.correct ?? 0;
  if (correct >= MASTERED_AT) return 'mastered';
  if (correct >= COLLECTED_AT) return 'collected';
  return 'none';
}

/** Add a Round's answers to the Passport. Unknown country codes are ignored; no answers returns `progress` unchanged. */
export function recordAnswers(progress: Progress, answers: readonly AnsweredCountry[]): Progress {
  const known = answers.filter((a) => getCountry(a.code) !== undefined);
  if (known.length === 0) return progress;
  const passport: Passport = { ...progress.passport };
  for (const { code, correct } of known) {
    const key = code.toLowerCase();
    const prev = passport[key] ?? { correct: 0, seen: 0 };
    passport[key] = { correct: prev.correct + (correct ? 1 : 0), seen: prev.seen + 1 };
  }
  return { ...progress, passport };
}

export type PassportTotals = {
  /** Countries in the Region. */
  total: number;
  collected: number;
  mastered: number;
};

/** Totals for a Region (default: All). Mastered countries also count as Collected. */
export function passportTotals(progress: Pick<Progress, 'passport'>, region: Region = 'all'): PassportTotals {
  const pool = poolFor(region);
  let collected = 0;
  let mastered = 0;
  for (const code of pool) {
    const state = stateOf(progress.passport[code]);
    if (state !== 'none') collected++;
    if (state === 'mastered') mastered++;
  }
  return { total: pool.length, collected, mastered };
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Tolerant: a missing or corrupt Passport gives an empty one; bad entries are dropped. */
export function parsePassport(value: unknown): Passport {
  const passport: Passport = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return passport;
  for (const [code, raw] of Object.entries(value as Record<string, unknown>)) {
    if (getCountry(code) === undefined || code !== code.toLowerCase()) continue;
    if (raw === null || typeof raw !== 'object') continue;
    const { correct, seen } = raw as Record<string, unknown>;
    if (!isCount(correct) || !isCount(seen) || correct > seen) continue;
    passport[code] = { correct, seen };
  }
  return passport;
}

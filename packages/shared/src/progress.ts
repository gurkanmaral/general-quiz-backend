import { parseAchievements, type AchievementRecord } from './achievements';
import { isDateKey } from './daily';
import { parsePassport, type Passport } from './passport';
import { isRegion, type Region } from './regions';
import { CLASSIC_QUESTION_COUNT, isGameMode, type GameMode, type RoundResult } from './round';
import {
  isDifficulty,
  isDirection,
  isQuiz,
  normalizeSetup,
  type Difficulty,
  type Direction,
  type Quiz,
  type RoundSetup,
} from './setup';

export type { Region, Difficulty, Direction, Quiz };

/**
 * Local player progress under one versioned schema, behind a tiny storage
 * adapter (Web Storage on web, an AsyncStorage-backed cache on mobile).
 * Every read and write is failure-safe: broken storage falls back to defaults.
 */

/** Minimal synchronous key-value storage (a subset of the Web Storage API). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const PROGRESS_KEY = 'flag-quiz:progress';
/** v1 key: the best Classic correct count out of 10. */
export const LEGACY_BEST_SCORE_KEY = 'flag-quiz:best-score';

export type Best = {
  points: number;
  correct: number;
  bestStreak: number;
};

/** One scored Daily Challenge, stored per Daily Date. */
export type DailyEntry = {
  points: number;
  correct: number;
  /** Correctness per Question, in order. */
  results: boolean[];
};

export type Progress = {
  v: 2;
  /** Bests keyed by `bestKey(...)`. */
  bests: Record<string, Best>;
  /** Daily Challenge results keyed by Daily Date (`YYYY-MM-DD`). Missing in older v2 data. */
  daily: Record<string, DailyEntry>;
  /** Flag Passport results keyed by lowercase country code. Missing in older v2 data. */
  passport: Passport;
  /** Unlocked Achievements with their first unlock time. Missing in older v2 data. */
  achievements: AchievementRecord;
  /** Total XP earned. Missing in older v2 data (0). */
  xp: number;
  /** The last `HISTORY_LIMIT` finished Rounds, oldest first. Missing in older v2 data. */
  history: RoundSummary[];
  /** Finished Rounds ever (history keeps only the last `HISTORY_LIMIT`). Missing in older v2 data. */
  roundsPlayed: number;
};

/** One finished Round, for Stats. */
export type RoundSummary = {
  /** ISO timestamp of when the Round finished. */
  date: string;
  mode: GameMode;
  quiz: Quiz;
  points: number;
  correct: number;
  answered: number;
};

/** Round summaries kept in `history` (the oldest are dropped). */
export const HISTORY_LIMIT = 50;

export function emptyProgress(): Progress {
  return { v: 2, bests: {}, daily: {}, passport: {}, achievements: {}, xp: 0, history: [], roundsPlayed: 0 };
}

/**
 * Best key per Game Mode × Region × Difficulty × Direction × Quiz. Flags keep the original
 * four-part key (`mode|region|difficulty|direction`); the other Quizzes add `|capitals` or `|shapes`.
 */
export function bestKey(
  mode: GameMode,
  region: Region = 'all',
  difficulty: Difficulty = 'normal',
  direction: Direction = 'flag',
  quiz: Quiz = 'flags',
): string {
  const base = `${mode}|${region}|${difficulty}|${direction}`;
  return quiz === 'flags' ? base : `${base}|${quiz}`;
}

/** The Best key of Higher or Lower (its Best is the longest run). */
export const HIGHER_LOWER_BEST_KEY = 'higherLower';

/** The value a mode's Best is compared on: correct answers in Survival, Points otherwise. */
export function bestMetric(mode: GameMode, best: Pick<Best, 'points' | 'correct'>): number {
  return mode === 'survival' ? best.correct : best.points;
}

/** The Best key of a Game Mode under a Round setup (missing or unknown fields: defaults). */
function setupBestKey(mode: GameMode, setup?: Partial<RoundSetup>): string {
  const { quiz, region, difficulty, direction } = normalizeSetup(setup);
  return bestKey(mode, region, difficulty, direction, quiz);
}

/** True for a well-formed `mode|region|difficulty|direction[|quiz]` key, or the Higher or Lower key. */
function isBestKey(key: string): boolean {
  if (key === HIGHER_LOWER_BEST_KEY) return true;
  const [mode, region, difficulty, direction, quiz, ...extra] = key.split('|');
  const validQuiz = quiz === undefined || (isQuiz(quiz) && quiz !== 'flags');
  return (
    extra.length === 0 && validQuiz && isGameMode(mode) && isRegion(region) && isDifficulty(difficulty) && isDirection(direction)
  );
}

/** A Game Mode's Best for a Round setup (default: All / Normal / Flag → Name). */
export function getBest(progress: Progress, mode: GameMode, setup?: Partial<RoundSetup>): Best | undefined {
  return progress.bests[setupBestKey(mode, setup)];
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function parseBest(value: unknown): Best | null {
  if (value === null || typeof value !== 'object') return null;
  const { points, correct, bestStreak } = value as Record<string, unknown>;
  if (!isCount(points) || !isCount(correct)) return null;
  return { points, correct, bestStreak: isCount(bestStreak) ? bestStreak : 0 };
}

function parseDailyEntry(value: unknown): DailyEntry | null {
  if (value === null || typeof value !== 'object') return null;
  const { points, correct, results } = value as Record<string, unknown>;
  if (!isCount(points) || !isCount(correct)) return null;
  if (!Array.isArray(results) || results.length !== CLASSIC_QUESTION_COUNT || !results.every((r) => typeof r === 'boolean')) return null;
  if (results.filter(Boolean).length !== correct) return null;
  return { points, correct, results: results.slice() };
}

/** Tolerant: a missing or corrupt Daily part gives an empty history; bad entries are dropped. */
function parseDaily(value: unknown): Record<string, DailyEntry> {
  const daily: Record<string, DailyEntry> = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return daily;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const entry = parseDailyEntry(raw);
    if (isDateKey(key) && entry) daily[key] = entry;
  }
  return daily;
}

function parseSummary(value: unknown): RoundSummary | null {
  if (value === null || typeof value !== 'object') return null;
  const { date, mode, quiz, points, correct, answered } = value as Record<string, unknown>;
  if (typeof date !== 'string' || date === '' || !isGameMode(mode) || !isQuiz(quiz)) return null;
  if (!isCount(points) || !isCount(correct) || !isCount(answered) || correct > answered) return null;
  return { date, mode, quiz, points, correct, answered };
}

/** Tolerant: a missing or corrupt history gives an empty one; bad entries are dropped; at most the newest `HISTORY_LIMIT`. */
function parseHistory(value: unknown): RoundSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parseSummary)
    .filter((s): s is RoundSummary => s !== null)
    .slice(-HISTORY_LIMIT);
}

function parseProgress(raw: string): Progress | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object' || (data as { v?: unknown }).v !== 2) return null;
  const rawBests = (data as { bests?: unknown }).bests;
  const bests: Record<string, Best> = {};
  if (rawBests !== null && typeof rawBests === 'object') {
    for (const [key, value] of Object.entries(rawBests as Record<string, unknown>)) {
      const best = parseBest(value);
      if (isBestKey(key) && best) bests[key] = best;
    }
  }
  const { daily, passport, achievements, xp, history, roundsPlayed } = data as {
    daily?: unknown;
    passport?: unknown;
    achievements?: unknown;
    xp?: unknown;
    history?: unknown;
    roundsPlayed?: unknown;
  };
  const parsedHistory = parseHistory(history);
  return {
    v: 2,
    bests,
    daily: parseDaily(daily),
    passport: parsePassport(passport),
    achievements: parseAchievements(achievements),
    xp: isCount(xp) ? xp : 0,
    history: parsedHistory,
    // Never fewer than the Rounds still in the history (older data had no counter).
    roundsPlayed: Math.max(isCount(roundsPlayed) ? roundsPlayed : 0, parsedHistory.length),
  };
}

function safeGet(store: KeyValueStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeRemove(store: KeyValueStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}

/** v1 best (correct count) → Classic Best with 100 Points per correct answer and no Speed Bonus. */
function migrateV1(raw: string | null): Progress | null {
  if (raw === null) return null;
  const value = Number(raw.trim());
  if (raw.trim() === '' || !Number.isInteger(value) || value < 0 || value > CLASSIC_QUESTION_COUNT) return null;
  return {
    ...emptyProgress(),
    bests: { [bestKey('classic')]: { points: value * 100, correct: value, bestStreak: 0 } },
  };
}

/** Load progress, migrating v1 data once. Corrupt or unavailable storage gives empty progress. */
export function loadProgress(store: KeyValueStore): Progress {
  const raw = safeGet(store, PROGRESS_KEY);
  const current = raw === null ? null : parseProgress(raw);
  if (current) {
    if (safeGet(store, LEGACY_BEST_SCORE_KEY) !== null) safeRemove(store, LEGACY_BEST_SCORE_KEY);
    return current;
  }
  const migrated = migrateV1(safeGet(store, LEGACY_BEST_SCORE_KEY));
  if (migrated) {
    if (saveProgress(store, migrated)) safeRemove(store, LEGACY_BEST_SCORE_KEY);
    return migrated;
  }
  return emptyProgress();
}

/** Persist progress. Returns false when storage is unavailable. */
export function saveProgress(store: KeyValueStore, progress: Progress): boolean {
  try {
    store.setItem(PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

/**
 * Record a finished Round's Best under its Game Mode and setup. Unfinished (quit) Rounds change nothing.
 * `isNewBest` is true only when the previous Best (or 0) is beaten; a Survival tie on
 * correct answers is beaten by higher Points.
 */
export function recordBest(progress: Progress, result: RoundResult): { progress: Progress; isNewBest: boolean } {
  if (!result.finished) return { progress, isNewBest: false };
  const key = setupBestKey(result.mode, result.setup);
  const stored = progress.bests[key];
  const metric = bestMetric(result.mode, result);
  const previous = stored ? bestMetric(result.mode, stored) : 0;
  // Survival ties on correct answers are broken by Points.
  const tieBreak =
    result.mode === 'survival' && stored !== undefined && metric === previous && result.points > stored.points;
  const isNewBest = metric > previous || tieBreak;
  if (!isNewBest && stored) return { progress, isNewBest: false };
  const best: Best = { points: result.points, correct: result.correct, bestStreak: result.bestStreak };
  return { progress: { ...progress, bests: { ...progress.bests, [key]: best } }, isNewBest };
}

/** The longest Higher or Lower run, or undefined when none was played. */
export function getHigherLowerBest(progress: Progress): number | undefined {
  return progress.bests[HIGHER_LOWER_BEST_KEY]?.correct;
}

/**
 * Record a finished Higher or Lower run (its length = correct picks in a row; a run of 0 is not recorded). The Best is
 * stored under `higherLower` with the run as `correct`, `points` and `bestStreak`.
 */
export function recordHigherLower(progress: Progress, run: number): { progress: Progress; isNewBest: boolean } {
  const length = Number.isInteger(run) && run > 0 ? run : 0;
  const previous = getHigherLowerBest(progress) ?? 0;
  // A zero run is never recorded; only a longer run replaces the Best.
  if (length <= previous) return { progress, isNewBest: false };
  const best: Best = { points: length, correct: length, bestStreak: length };
  return { progress: { ...progress, bests: { ...progress.bests, [HIGHER_LOWER_BEST_KEY]: best } }, isNewBest: true };
}

/**
 * Record a finished Daily Challenge under its Daily Date. Only the first scored attempt
 * counts: an existing entry, an unfinished (quit) Round or a non-Daily Round changes nothing.
 * Throws on a malformed key.
 */
export function recordDaily(progress: Progress, key: string, result: RoundResult): Progress {
  if (!isDateKey(key)) throw new Error(`Invalid Daily Date key ${JSON.stringify(key)}: expected YYYY-MM-DD.`);
  if (!result.finished || result.mode !== 'daily' || progress.daily[key]) return progress;
  const entry: DailyEntry = { points: result.points, correct: result.correct, results: result.results.slice() };
  return { ...progress, daily: { ...progress.daily, [key]: entry } };
}

/** Add a finished Round to `history`, dropping the oldest beyond `HISTORY_LIMIT`. Quit Rounds change nothing. */
export function recordHistory(progress: Progress, result: RoundResult, date: string): Progress {
  if (!result.finished) return progress;
  const summary: RoundSummary = {
    date,
    mode: result.mode,
    quiz: result.setup.quiz,
    points: result.points,
    correct: result.correct,
    answered: result.answered,
  };
  return {
    ...progress,
    history: [...progress.history, summary].slice(-HISTORY_LIMIT),
    roundsPlayed: progress.roundsPlayed + 1,
  };
}

/** Clear all progress (Bests, Daily history, Passport, Achievements, XP, Round history and the v1 key). Settings such as the Locale live elsewhere and are kept. */
export function resetProgress(store: KeyValueStore): Progress {
  safeRemove(store, PROGRESS_KEY);
  safeRemove(store, LEGACY_BEST_SCORE_KEY);
  return emptyProgress();
}

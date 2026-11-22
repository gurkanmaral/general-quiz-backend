import { COUNTRIES } from './countries';
import { populationOf } from './facts';
import { createSeededRandom, type RandomFn } from './random';

/**
 * Higher or Lower: two countries, "Which has more people?". Pick the larger population
 * to extend the run; the first miss ends it. The winner stays as the left card and a new
 * right card is drawn. Pure: state is never mutated, and the same `random` gives the same pairs.
 */

export type HigherLowerSide = 'left' | 'right';

/** Pairs are never closer than this (relative to the larger population), so each has a clear answer. */
export const HIGHER_LOWER_MIN_GAP = 0.03;

export type HigherLowerAnswer = {
  left: string;
  right: string;
  pick: HigherLowerSide;
  correct: boolean;
};

export type HigherLowerState = {
  /** Country codes the game draws from (each has a population). */
  readonly pool: readonly string[];
  readonly left: string;
  readonly right: string;
  /** Codes already shown in this pass (a new pass starts once every country was shown). */
  readonly seen: readonly string[];
  /** PRNG state for the next card. */
  readonly seed: number;
  /** Correct picks in a row. */
  readonly run: number;
  readonly finished: boolean;
  /** The last answered pair (for the reveal), or null before the first answer. */
  readonly last: HigherLowerAnswer | null;
};

export type HigherLowerResult = {
  run: number;
  finished: boolean;
};

export type CreateHigherLowerOptions = {
  /** Random source in [0, 1). Defaults to Math.random. */
  random?: RandomFn;
  /** Country codes to draw from. Defaults to every country; codes without a population are skipped. */
  pool?: readonly string[];
};

const UINT32 = 4294967296;

/** True when two populations are far enough apart to be paired. */
export function isClearPair(a: string, b: string): boolean {
  const pa = populationOf(a);
  const pb = populationOf(b);
  if (pa === undefined || pb === undefined || a === b) return false;
  return Math.abs(pa - pb) / Math.max(pa, pb) >= HIGHER_LOWER_MIN_GAP;
}

/** The side with more people. Only meaningful for a clear pair. */
export function higherSide(left: string, right: string): HigherLowerSide {
  return (populationOf(left) ?? 0) >= (populationOf(right) ?? 0) ? 'left' : 'right';
}

/** A new right card for `left`: unseen in this pass when possible, and never a near-equal population. */
function drawRight(pool: readonly string[], left: string, seen: readonly string[], random: RandomFn) {
  const seenSet = new Set(seen);
  let candidates = pool.filter((c) => !seenSet.has(c) && isClearPair(left, c));
  let nextSeen = seen;
  if (candidates.length === 0) {
    // Pass used up: start a new one (only the left card counts as seen).
    nextSeen = [left];
    candidates = pool.filter((c) => c !== left && isClearPair(left, c));
  }
  if (candidates.length === 0) throw new Error(`Higher or Lower: no country to pair with ${left}.`);
  const right = candidates[Math.floor(random() * candidates.length)] as string;
  return { right, seen: [...nextSeen, right] };
}

export function createHigherLower({ random = Math.random, pool: requested }: CreateHigherLowerOptions = {}): HigherLowerState {
  const source = requested ?? COUNTRIES.map((c) => c.code);
  const pool = Array.from(new Set(source)).filter((c) => populationOf(c) !== undefined);
  if (pool.length < 2) throw new Error(`Higher or Lower needs at least 2 countries (got ${pool.length}).`);
  const r = createSeededRandom(Math.floor(random() * UINT32));
  const left = pool[Math.floor(r() * pool.length)] as string;
  const { right, seen } = drawRight(pool, left, [left], r);
  return {
    pool,
    left,
    right,
    seen,
    seed: Math.floor(r() * UINT32),
    run: 0,
    finished: false,
    last: null,
  };
}

/**
 * Pick the side with more people. Correct: the run grows, the winner stays as the left card and a
 * new right card appears. Wrong: the run ends. A finished game ignores further picks.
 */
export function answerHigherLower(state: HigherLowerState, side: HigherLowerSide): HigherLowerState {
  if (state.finished) return state;
  const correct = side === higherSide(state.left, state.right);
  const last: HigherLowerAnswer = { left: state.left, right: state.right, pick: side, correct };
  if (!correct) return { ...state, finished: true, last };
  const winner = side === 'left' ? state.left : state.right;
  const r = createSeededRandom(state.seed);
  const { right, seen } = drawRight(state.pool, winner, state.seen, r);
  return {
    ...state,
    left: winner,
    right,
    seen,
    seed: Math.floor(r() * UINT32),
    run: state.run + 1,
    last,
  };
}

export function getHigherLowerResult(state: HigherLowerState): HigherLowerResult {
  return { run: state.run, finished: state.finished };
}

import { COUNTRIES } from './countries';
import type { Passport } from './passport';
import type { Progress } from './progress';
import { shuffle, type RandomFn } from './random';

/**
 * Learn mode: a practice flashcard deck of the player's weakest countries.
 * Practice only: nothing here touches the Passport, Bests or Achievements.
 */

export const LEARN_DECK_SIZE = 10;
/** "Again" puts the card back this many cards later. */
export const LEARN_AGAIN_GAP = 3;

const misses = (passport: Passport, code: string) => {
  const e = passport[code];
  return e ? e.seen - e.correct : 0;
};

/**
 * The weakest countries, weakest first:
 * 1. missed countries, most misses first (then lower accuracy);
 * 2. never-seen countries, in random order;
 * 3. seen countries with no misses, fewest correct first (ties random).
 * With no data the deck is `size` random countries.
 */
export function buildLearnDeck(
  progress: Pick<Progress, 'passport'>,
  random: RandomFn = Math.random,
  size: number = LEARN_DECK_SIZE,
): string[] {
  const { passport } = progress;
  const codes = shuffle(
    COUNTRIES.map((c) => c.code),
    random,
  );
  const missed: string[] = [];
  const unseen: string[] = [];
  const clean: string[] = [];
  for (const code of codes) {
    const entry = passport[code];
    if (!entry || entry.seen === 0) unseen.push(code);
    else if (entry.seen > entry.correct) missed.push(code);
    else clean.push(code);
  }
  const accuracy = (code: string) => {
    const e = passport[code];
    return e && e.seen > 0 ? e.correct / e.seen : 0;
  };
  // Array.prototype.sort is stable, so ties keep the shuffled order.
  missed.sort((a, b) => misses(passport, b) - misses(passport, a) || accuracy(a) - accuracy(b));
  clean.sort((a, b) => (passport[a]?.correct ?? 0) - (passport[b]?.correct ?? 0));
  return [...missed, ...unseen, ...clean].slice(0, Math.max(0, Math.floor(size)));
}

/**
 * Where an "Again" card goes in the remaining deck (after removing it): `LEARN_AGAIN_GAP`
 * cards later, or last when fewer cards remain.
 */
export function againIndex(remaining: number): number {
  return Math.max(0, Math.min(LEARN_AGAIN_GAP, remaining));
}

/** "Got it": the current (first) card leaves the deck. */
export function learnGotIt(deck: readonly string[]): string[] {
  return deck.slice(1);
}

/** "Again": the current (first) card comes back `LEARN_AGAIN_GAP` cards later (or last). */
export function learnAgain(deck: readonly string[]): string[] {
  if (deck.length === 0) return [];
  const [card, ...rest] = deck as [string, ...string[]];
  const at = againIndex(rest.length);
  return [...rest.slice(0, at), card, ...rest.slice(at)];
}

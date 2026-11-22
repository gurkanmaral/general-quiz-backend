import { COUNTRIES } from './countries';
import { createSeededRandom, type RandomFn } from './random';
import { CLASSIC_QUESTION_COUNT, createRound, type RoundState } from './round';
import { BASE_POINTS, SPEED_BONUS_MAX, streakMultiplier } from './scoring';
import { isDifficulty, isDirection, isQuiz, type RoundSetup } from './setup';
import { isRegion } from './regions';

/**
 * Challenge a friend: a Classic Round is driven by a seed, so its setup and seed
 * (plus the challenger's score) are enough to replay the identical Round anywhere.
 * The payload is versioned base64url JSON with no personal data.
 */

export const CHALLENGE_VERSION = 1;

/**
 * Version of the country data and Round generation a Challenge replays on. Bump it whenever
 * COUNTRIES, the Options or the Round engine change what a seed produces (the golden test in
 * depth.test.ts fails then): older links are then reported as outdated instead of replaying
 * different Questions.
 */
export const CHALLENGE_DATA_VERSION = 1;

export type Challenge = {
  /** Unsigned 32-bit seed of the Round. */
  seed: number;
  setup: RoundSetup;
  /** The challenger's Points and correct answers. */
  points: number;
  correct: number;
};

const UINT32 = 4294967296;

/** The highest Classic score with `correct` right answers: all instant and in one streak. */
export function maxClassicPoints(correct: number): number {
  let total = 0;
  for (let streak = 1; streak <= correct; streak++) total += (BASE_POINTS + SPEED_BONUS_MAX) * streakMultiplier(streak);
  return total;
}

/** A fresh Round seed drawn from `random`. */
export function newSeed(random: RandomFn = Math.random): number {
  return Math.floor(random() * UINT32) >>> 0;
}

/** The Classic Round of a seed and setup (same Questions and Option order on every platform). */
export function createSeededClassicRound(seed: number, setup: RoundSetup, nowMs: number): RoundState {
  return createRound({ mode: 'classic', countries: COUNTRIES, setup, random: createSeededRandom(seed), nowMs });
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url (no padding) of an ASCII string. No Buffer / btoa, so it runs the same in React Native. */
function toBase64Url(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i);
    const b = i + 1 < text.length ? text.charCodeAt(i + 1) : NaN;
    const c = i + 2 < text.length ? text.charCodeAt(i + 2) : NaN;
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (!Number.isNaN(b)) out += ALPHABET[(n >> 6) & 63]!;
    if (!Number.isNaN(c)) out += ALPHABET[n & 63]!;
  }
  return out;
}

/** Decode base64url (no padding) to an ASCII string, or null when malformed. */
function fromBase64Url(data: string): string | null {
  if (data.length % 4 === 1) return null;
  let out = '';
  for (let i = 0; i < data.length; i += 4) {
    const chunk = data.slice(i, i + 4);
    const values = [...chunk].map((ch) => ALPHABET.indexOf(ch));
    if (values.some((v) => v < 0)) return null;
    const [w = 0, x = 0, y = 0, z = 0] = values;
    const n = (w << 18) | (x << 12) | (y << 6) | z;
    out += String.fromCharCode((n >> 16) & 255);
    if (chunk.length > 2) out += String.fromCharCode((n >> 8) & 255);
    if (chunk.length > 3) out += String.fromCharCode(n & 255);
  }
  return out;
}

/** The link payload of a Challenge (base64url JSON, version 1). */
export function encodeChallenge({ seed, setup, points, correct }: Challenge): string {
  const json = JSON.stringify({
    v: CHALLENGE_VERSION,
    g: CHALLENGE_DATA_VERSION,
    s: seed >>> 0,
    q: setup.quiz,
    r: setup.region,
    d: setup.difficulty,
    o: setup.direction,
    p: points,
    c: correct,
  });
  return toBase64Url(json);
}

const isUint = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

export type ParsedChallenge =
  | { ok: true; challenge: Challenge }
  /** `broken`: malformed or an unknown link version. `outdated`: made for other country data. */
  | { ok: false; reason: 'broken' | 'outdated' };

const BROKEN = { ok: false, reason: 'broken' } as const;

/** Decode and validate a Challenge payload, saying why a bad one cannot be played. */
export function parseChallenge(payload: string): ParsedChallenge {
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > 400) return BROKEN;
  const json = fromBase64Url(payload);
  if (json === null || /[^\x20-\x7e]/.test(json)) return BROKEN;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return BROKEN;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return BROKEN;
  const { v, g, s, q, r, d, o, p, c } = data as Record<string, unknown>;
  if (v !== CHALLENGE_VERSION) return BROKEN;
  if (!isUint(s, UINT32 - 1) || !isUint(c, CLASSIC_QUESTION_COUNT) || !isUint(p, maxClassicPoints(c))) return BROKEN;
  if (!isQuiz(q) || !isRegion(r) || !isDifficulty(d) || !isDirection(o)) return BROKEN;
  if (!isUint(g, Number.MAX_SAFE_INTEGER)) return BROKEN;
  if (g !== CHALLENGE_DATA_VERSION) return { ok: false, reason: 'outdated' };
  return { ok: true, challenge: { seed: s, setup: { quiz: q, region: r, difficulty: d, direction: o }, points: p, correct: c } };
}

/** Decode and validate a Challenge payload. Malformed, outdated or unknown-version links give null. */
export function decodeChallenge(payload: string): Challenge | null {
  const parsed = parseChallenge(payload);
  return parsed.ok ? parsed.challenge : null;
}

export type ChallengeOutcome = 'win' | 'lose' | 'tie';

/** The player's outcome against the challenger, on Points. */
export function challengeOutcome(points: number, friendPoints: number): ChallengeOutcome {
  if (points > friendPoints) return 'win';
  if (points < friendPoints) return 'lose';
  return 'tie';
}

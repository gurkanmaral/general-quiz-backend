import { COUNTRIES } from './countries';
import type { Locale } from './i18n';
import type { DailyEntry } from './progress';
import { createSeededRandom } from './random';
import { createRound, type RoundState } from './round';
import { uiResources } from './uiResources';

/**
 * Daily Challenge (FR-14 to FR-16). Everything here is pure and depends only on
 * the Daily Date key (`YYYY-MM-DD`, the player's local calendar date, passed in
 * by the app) and `COUNTRIES`, so web and mobile generate identical Rounds.
 */

/** Launch day: Daily #1. */
export const DAILY_EPOCH = '2026-11-07';

const DAY_MS = 86_400_000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as `YYYY-MM-DD`. */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_KEY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function assertDateKey(key: unknown): asserts key is string {
  if (!isDateKey(key)) throw new Error(`Invalid Daily Date key ${JSON.stringify(key)}: expected YYYY-MM-DD.`);
}

/** Calendar day number of a key (days since 1970-01-01), using UTC maths so DST never matters. */
function dayIndex(key: string): number {
  assertDateKey(key);
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromDayIndex(index: number): string {
  const date = new Date(index * DAY_MS);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** The key `n` calendar days after `key` (negative `n` goes back). */
export function addDays(key: string, n: number): string {
  return fromDayIndex(dayIndex(key) + Math.trunc(n));
}

/** Daily number: days since `DAILY_EPOCH` + 1. Keys before the epoch give 1. Throws on a malformed key. */
export function dailyNumber(key: string): number {
  return Math.max(1, dayIndex(key) - dayIndex(DAILY_EPOCH) + 1);
}

/** 32-bit FNV-1a hash of the key: the Daily Round's PRNG seed. */
export function dailySeed(key: string): number {
  assertDateKey(key);
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The Daily Challenge Round for a Daily Date: Classic rules, all countries, seeded from the key only. */
export function createDailyRound(key: string, nowMs: number): RoundState {
  return createRound({ mode: 'daily', countries: COUNTRIES, random: createSeededRandom(dailySeed(key)), nowMs });
}

/**
 * Daily Streak: consecutive Daily Dates played, ending today, or yesterday
 * when today is not played yet (the streak stays alive until today ends).
 */
export function dailyStreak(entries: Readonly<Record<string, DailyEntry>>, todayKey: string): number {
  let day = entries[todayKey] ? todayKey : addDays(todayKey, -1);
  let streak = 0;
  while (entries[day]) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

export type ShareTemplates = {
  /** e.g. `Flag Quiz Daily #{{number}}` */
  title: string;
  /** e.g. `{{correct}}/{{total}} · {{points}} pts` */
  score: string;
};

export type ShareTextInput = {
  number: number;
  /** One entry per Question: true = correct. */
  results: readonly boolean[];
  correct: number;
  total: number;
  points: number;
  locale: Locale;
  /** App link appended as the last line. */
  url: string;
  /** Locale-aware number formatting ("1,240" / "1.240"). */
  formatNumber: (value: number, locale: Locale) => string;
  /** Translated templates; defaults to the shared `share.*` strings for `locale`. */
  templates?: ShareTemplates;
};

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => values[name] ?? match);
}

/** Spoiler-free share text: title, one 🟩/🟥 per Question, score and Points, link. No country names. */
export function shareText({
  number,
  results,
  correct,
  total,
  points,
  locale,
  url,
  formatNumber,
  templates = uiResources[locale].share,
}: ShareTextInput): string {
  const grid = results.map((ok) => (ok ? '🟩' : '🟥')).join('');
  const score = fill(templates.score, {
    correct: formatNumber(correct, locale),
    total: formatNumber(total, locale),
    points: formatNumber(points, locale),
  });
  return [fill(templates.title, { number: String(number) }), grid, score, url].join('\n');
}

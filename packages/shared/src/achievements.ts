import { dailyStreak } from './daily';
import { COUNTRIES } from './countries';
import { passportTotals } from './passport';
import type { Progress } from './progress';
import { CONTINENTS, type Continent } from './regions';
import { CLASSIC_QUESTION_COUNT, type RoundResult } from './round';

/**
 * Achievements (FR-19): a fixed set of one-time milestones. They are evaluated only
 * after a finished Round (a quit Round unlocks nothing), unlock once and keep the
 * date they were first unlocked. Pure: the unlock time and today's key are passed in.
 */

export const ACHIEVEMENT_IDS = [
  'firstSteps',
  'perfect10',
  'onFire',
  'unstoppable',
  'speedDemon',
  'survivor',
  'dailyHabit',
  'continental',
  'collector50',
  'collector100',
  'collector193',
  'hardModeHero',
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** Icon keys; each platform maps them to its own icons. */
export type AchievementIcon = 'flag' | 'target' | 'flame' | 'bolt' | 'clock' | 'heart' | 'calendar' | 'globe' | 'stamp' | 'trophy';

export type AchievementProgress = {
  current: number;
  target: number;
  /** Continental only: the continent the progress is for. */
  continent?: Continent;
};

export type Achievement = {
  id: AchievementId;
  icon: AchievementIcon;
  /** Progress towards a countable Achievement (`current` capped at `target`); absent for one-Round feats. */
  progress?: (progress: Progress, todayKey: string) => AchievementProgress;
};

export type UnlockedAchievement = {
  /** ISO timestamp of the first unlock. */
  unlockedAt: string;
};

export type AchievementRecord = Partial<Record<AchievementId, UnlockedAchievement>>;

export const DAILY_HABIT_DAYS = 7;
export const ON_FIRE_STREAK = 10;
export const UNSTOPPABLE_STREAK = 25;
export const SPEED_DEMON_CORRECT = 20;
export const SURVIVOR_CORRECT = 25;
/** Collector 193: every country in the game. */
export const ALL_COUNTRIES = COUNTRIES.length;

const capped = (current: number, target: number): AchievementProgress => ({ current: Math.min(current, target), target });

const collector = (target: number) => (progress: Progress) => capped(passportTotals(progress).collected, target);

/** The continent closest to fully Mastered (by share of its countries). */
function bestContinent(progress: Progress): AchievementProgress {
  let best: AchievementProgress = { current: 0, target: 1, continent: CONTINENTS[0] };
  let bestRatio = -1;
  for (const continent of CONTINENTS) {
    const { mastered, total } = passportTotals(progress, continent);
    const ratio = mastered / total;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = { current: mastered, target: total, continent };
    }
  }
  return best;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'firstSteps', icon: 'flag' },
  { id: 'perfect10', icon: 'target' },
  { id: 'onFire', icon: 'flame' },
  { id: 'unstoppable', icon: 'bolt' },
  { id: 'speedDemon', icon: 'clock' },
  { id: 'survivor', icon: 'heart' },
  {
    id: 'dailyHabit',
    icon: 'calendar',
    progress: (progress, todayKey) => capped(dailyStreak(progress.daily, todayKey), DAILY_HABIT_DAYS),
  },
  { id: 'continental', icon: 'globe', progress: bestContinent },
  { id: 'collector50', icon: 'stamp', progress: collector(50) },
  { id: 'collector100', icon: 'stamp', progress: collector(100) },
  { id: 'collector193', icon: 'stamp', progress: collector(ALL_COUNTRIES) },
  { id: 'hardModeHero', icon: 'trophy' },
];

export function isAchievementId(value: unknown): value is AchievementId {
  return typeof value === 'string' && (ACHIEVEMENT_IDS as readonly string[]).includes(value);
}

/** Unlocked Achievements count. */
export function unlockedCount(progress: Pick<Progress, 'achievements'>): number {
  return ACHIEVEMENT_IDS.filter((id) => progress.achievements[id] !== undefined).length;
}

const isPerfectClassic = (r: RoundResult) =>
  r.mode === 'classic' && r.answered === CLASSIC_QUESTION_COUNT && r.correct === CLASSIC_QUESTION_COUNT;

/** Whether the condition of each Achievement holds after this Round (progress already includes it). */
function earned(id: AchievementId, progress: Progress, result: RoundResult, todayKey: string): boolean {
  switch (id) {
    case 'firstSteps':
      return true;
    case 'perfect10':
      return isPerfectClassic(result);
    case 'hardModeHero':
      return isPerfectClassic(result) && result.setup.difficulty === 'hard';
    case 'onFire':
      return result.bestStreak >= ON_FIRE_STREAK;
    case 'unstoppable':
      return result.bestStreak >= UNSTOPPABLE_STREAK;
    case 'speedDemon':
      return result.mode === 'timeAttack' && result.correct >= SPEED_DEMON_CORRECT;
    case 'survivor':
      return result.mode === 'survival' && result.correct >= SURVIVOR_CORRECT;
    case 'dailyHabit':
      return result.mode === 'daily' && dailyStreak(progress.daily, todayKey) >= DAILY_HABIT_DAYS;
    case 'continental':
      return CONTINENTS.some((c) => {
        const { mastered, total } = passportTotals(progress, c);
        return mastered === total;
      });
    case 'collector50':
      return passportTotals(progress).collected >= 50;
    case 'collector100':
      return passportTotals(progress).collected >= 100;
    case 'collector193':
      return passportTotals(progress).collected >= ALL_COUNTRIES;
  }
}

export type EvaluateAchievementsInput = {
  /** Progress after this Round's Best, Daily result and Passport were recorded. */
  progress: Progress;
  result: RoundResult;
  /** Today's Daily Date (`YYYY-MM-DD`), for the Daily Streak. */
  todayKey: string;
  /** ISO timestamp stored for newly unlocked Achievements. */
  unlockedAt: string;
};

/**
 * Unlock the Achievements this finished Round earned. Already unlocked ones keep their
 * date. A quit (unfinished) Round unlocks nothing. `unlocked` lists the new ones in
 * `ACHIEVEMENTS` order; with none, `progress` is returned unchanged.
 */
export function evaluateAchievements({ progress, result, todayKey, unlockedAt }: EvaluateAchievementsInput): {
  progress: Progress;
  unlocked: AchievementId[];
} {
  if (!result.finished) return { progress, unlocked: [] };
  const unlocked = ACHIEVEMENT_IDS.filter(
    (id) => progress.achievements[id] === undefined && earned(id, progress, result, todayKey),
  );
  if (unlocked.length === 0) return { progress, unlocked };
  const achievements: AchievementRecord = { ...progress.achievements };
  for (const id of unlocked) achievements[id] = { unlockedAt };
  return { progress: { ...progress, achievements }, unlocked };
}

/** Tolerant: a missing or corrupt part gives no Achievements; unknown ids and bad dates are dropped. */
export function parseAchievements(value: unknown): AchievementRecord {
  const record: AchievementRecord = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return record;
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isAchievementId(id) || raw === null || typeof raw !== 'object') continue;
    const { unlockedAt } = raw as Record<string, unknown>;
    if (typeof unlockedAt !== 'string' || unlockedAt === '' || Number.isNaN(Date.parse(unlockedAt))) continue;
    record[id] = { unlockedAt };
  }
  return record;
}

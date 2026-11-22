import type { Progress } from './progress';
import type { RoundResult } from './round';

/**
 * XP and Levels. Every finished Round (any Game Mode, the Daily and Challenges included)
 * grants XP = round(points / 10). Quit Rounds, Higher or Lower runs and Learn grant none.
 * Finishing Level L needs `100·L·(L+1)/2` total XP: Level 1 runs 0–99, Level 2 100–299,
 * Level 3 300–599, …
 */

/** Points per XP. */
export const POINTS_PER_XP = 10;

/** XP a Round result grants: round(points / 10) when finished, else 0. */
export function xpForResult(result: Pick<RoundResult, 'points' | 'finished'>): number {
  if (!result.finished || !Number.isFinite(result.points) || result.points <= 0) return 0;
  return Math.round(result.points / POINTS_PER_XP);
}

/** Total XP needed to finish `level` (0 for level 0): 100·L·(L+1)/2. */
export function levelThreshold(level: number): number {
  const l = Math.max(0, Math.floor(level));
  return (100 * l * (l + 1)) / 2;
}

export type LevelInfo = {
  /** Current Level, from 1. */
  level: number;
  /** XP earned inside the current Level. */
  into: number;
  /** XP the current Level spans (into < needed). */
  needed: number;
};

/** The Level of a total XP. Negative or invalid XP counts as 0. */
export function levelOf(xp: number): LevelInfo {
  const total = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  let level = 1;
  while (levelThreshold(level) <= total) level++;
  const start = levelThreshold(level - 1);
  return { level, into: total - start, needed: levelThreshold(level) - start };
}

export type XpGain = {
  gained: number;
  before: LevelInfo;
  after: LevelInfo;
  levelUp: boolean;
};

/** Add a Round's XP to progress. A Round that grants nothing returns `progress` unchanged. */
export function recordXp(progress: Progress, result: Pick<RoundResult, 'points' | 'finished'>): { progress: Progress; xp: XpGain } {
  const gained = xpForResult(result);
  const before = levelOf(progress.xp);
  const next = gained > 0 ? { ...progress, xp: progress.xp + gained } : progress;
  const after = levelOf(next.xp);
  return { progress: next, xp: { gained, before, after, levelUp: after.level > before.level } };
}

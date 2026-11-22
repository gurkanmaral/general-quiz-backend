/** Points for every correct answer before the Speed Bonus and Streak Multiplier. */
export const BASE_POINTS = 100;
/** The largest Speed Bonus, earned by an instant answer. */
export const SPEED_BONUS_MAX = 50;
/** The Speed Bonus falls linearly to 0 over this many milliseconds. */
export const SPEED_BONUS_WINDOW_MS = 10_000;

/** Streak Multiplier for a Streak (including the answer being scored): ×1 at 1–2, ×2 at 3–5, ×3 at 6+. */
export function streakMultiplier(streak: number): number {
  if (streak >= 6) return 3;
  if (streak >= 3) return 2;
  return 1;
}

/** Speed Bonus for an answer given `elapsedMs` after the Question was shown. Negative or invalid elapsed counts as 0. */
export function speedBonus(elapsedMs: number): number {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (elapsed >= SPEED_BONUS_WINDOW_MS) return 0;
  return Math.round(SPEED_BONUS_MAX * (1 - elapsed / SPEED_BONUS_WINDOW_MS));
}

export type PointsInput = {
  correct: boolean;
  /** Time since the Question was shown. */
  elapsedMs: number;
  /** Streak including this answer. */
  streak: number;
};

/** Points = (100 + Speed Bonus) × Streak Multiplier for a correct answer, 0 for a wrong one. */
export function pointsFor({ correct, elapsedMs, streak }: PointsInput): number {
  if (!correct) return 0;
  return (BASE_POINTS + speedBonus(elapsedMs)) * streakMultiplier(Math.max(1, streak));
}

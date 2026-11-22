import { describe, expect, it } from 'vitest';
import { pointsFor, speedBonus, SPEED_BONUS_MAX, streakMultiplier } from './scoring';

describe('streakMultiplier', () => {
  it('steps ×1, ×1, ×2, ×2, ×3, ×3 for Streaks 1, 2, 3, 5, 6, 9', () => {
    expect([1, 2, 3, 5, 6, 9].map(streakMultiplier)).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

describe('speedBonus', () => {
  it('falls linearly from 50 at 0 s to 0 at 10 s, rounded', () => {
    expect(SPEED_BONUS_MAX).toBe(50);
    expect(speedBonus(0)).toBe(50);
    expect(speedBonus(2000)).toBe(40);
    expect(speedBonus(5000)).toBe(25);
    expect(speedBonus(1234)).toBe(44); // 43.83 → 44
    expect(speedBonus(10_000)).toBe(0);
    expect(speedBonus(15_000)).toBe(0);
  });

  it('treats negative or invalid elapsed time as 0', () => {
    expect(speedBonus(-500)).toBe(50);
    expect(speedBonus(Number.NaN)).toBe(50);
  });
});

describe('pointsFor', () => {
  it('scores the PRD example: correct in 2 s at Streak 4 → 280', () => {
    expect(pointsFor({ correct: true, elapsedMs: 2000, streak: 4 })).toBe(280);
  });

  it('scores a slow correct answer at Streak 1 → 100', () => {
    expect(pointsFor({ correct: true, elapsedMs: 15_000, streak: 1 })).toBe(100);
  });

  it('treats negative elapsed as 0', () => {
    expect(pointsFor({ correct: true, elapsedMs: -1000, streak: 1 })).toBe(150);
  });

  it('scores 0 for a wrong answer', () => {
    expect(pointsFor({ correct: false, elapsedMs: 0, streak: 0 })).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import fixtures from '../../content/fixtures/streak-cases.json';
import { computeStreak, countsForStreak, shiftDateKey, STREAK_REPAIR_DAYS } from './knoStreak';

describe('KNO. Streak (shared fixtures)', () => {
  it('uses the same repair window as the fixtures', () => {
    expect(fixtures.repairDays).toBe(STREAK_REPAIR_DAYS);
  });

  it.each(fixtures.cases)('$name', ({ plays, today, expected }) => {
    expect(computeStreak(plays, today, fixtures.repairDays)).toEqual(expected);
  });
});

describe('countsForStreak', () => {
  it('counts plays up to three days late and rejects later or invalid ones', () => {
    expect(countsForStreak({ dailyDate: '2026-11-13', playedOn: '2026-11-16' })).toBe(true);
    expect(countsForStreak({ dailyDate: '2026-11-12', playedOn: '2026-11-16' })).toBe(false);
    expect(countsForStreak({ dailyDate: '2026-11-16', playedOn: '2026-11-15' })).toBe(false);
    expect(countsForStreak({ dailyDate: 'nope', playedOn: '2026-11-15' })).toBe(false);
  });

  it('shifts dates across month and year boundaries', () => {
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
  });
});

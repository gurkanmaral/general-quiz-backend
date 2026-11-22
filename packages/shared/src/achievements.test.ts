import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_IDS,
  ACHIEVEMENTS,
  evaluateAchievements,
  parseAchievements,
  unlockedCount,
  type AchievementId,
} from './achievements';
import { COUNTRIES } from './countries';
import { addDays } from './daily';
import { recordAnswers } from './passport';
import { emptyProgress, recordDaily, type Progress } from './progress';
import { poolFor } from './regions';
import type { RoundResult } from './round';

const TODAY = '2026-11-20';
const AT = '2026-11-20T09:30:00.000Z';
const LATER = '2026-12-01T10:00:00.000Z';

const result = (over: Partial<RoundResult>): RoundResult => ({
  mode: 'classic',
  setup: { quiz: 'flags', region: 'all', difficulty: 'normal', direction: 'flag' },
  points: 0,
  correct: 0,
  answered: 10,
  bestStreak: 0,
  missed: [],
  results: [],
  answers: [],
  finished: true,
  endReason: 'questions',
  ...over,
});

/** Progress with First Steps already unlocked, so tests see only the Achievement under test. */
const started = (): Progress => ({ ...emptyProgress(), achievements: { firstSteps: { unlockedAt: AT } } });

const evaluate = (progress: Progress, r: RoundResult, todayKey = TODAY, unlockedAt = AT) =>
  evaluateAchievements({ progress, result: r, todayKey, unlockedAt });

const collect = (progress: Progress, codes: readonly string[], times = 1): Progress =>
  recordAnswers(progress, Array.from({ length: times }, () => codes.map((code) => ({ code, correct: true }))).flat());

describe('ACHIEVEMENTS', () => {
  it('is the fixed v2 set of 12 in a stable order', () => {
    expect(ACHIEVEMENTS.map((a) => a.id)).toEqual([...ACHIEVEMENT_IDS]);
    expect(ACHIEVEMENT_IDS).toHaveLength(12);
  });

  it('reports progress for the countable ones', () => {
    let progress = collect(emptyProgress(), COUNTRIES.slice(0, 37).map((c) => c.code));
    const of = (id: AchievementId) => ACHIEVEMENTS.find((a) => a.id === id)?.progress?.(progress, TODAY);
    expect(of('collector50')).toEqual({ current: 37, target: 50 });
    expect(of('collector193')).toEqual({ current: 37, target: 193 });
    expect(of('firstSteps')).toBeUndefined();
    progress = collect(progress, ['fj', 'ws'], 3);
    expect(of('continental')).toEqual({ current: 2, target: 14, continent: 'oceania' });
    for (let i = 0; i < 3; i++) progress = recordDaily(progress, addDays(TODAY, -i), result({ mode: 'daily' }));
    expect(of('dailyHabit')).toEqual({ current: 3, target: 7 });
  });
});

describe('evaluateAchievements', () => {
  it('First Steps: unlocks on the first finished Round with any score, then keeps its date', () => {
    const first = evaluate(emptyProgress(), result({ correct: 0 }));
    expect(first.unlocked).toEqual(['firstSteps']);
    expect(first.progress.achievements.firstSteps).toEqual({ unlockedAt: AT });
    const again = evaluate(first.progress, result({ correct: 3 }), TODAY, LATER);
    expect(again.unlocked).toEqual([]);
    expect(again.progress).toBe(first.progress);
    expect(again.progress.achievements.firstSteps?.unlockedAt).toBe(AT);
  });

  it('a quit Round unlocks nothing', () => {
    const progress = collect(emptyProgress(), COUNTRIES.slice(0, 60).map((c) => c.code));
    const out = evaluate(progress, result({ finished: false, endReason: null, bestStreak: 30 }));
    expect(out).toEqual({ progress, unlocked: [] });
  });

  it('Perfect 10: Classic 10/10 with any setup, but not a Daily 10/10', () => {
    const reverse = { quiz: 'flags', region: 'europe', difficulty: 'normal', direction: 'name' } as const;
    expect(evaluate(started(), result({ correct: 10, setup: reverse })).unlocked).toContain('perfect10');
    expect(evaluate(started(), result({ correct: 9 })).unlocked).not.toContain('perfect10');
    expect(evaluate(started(), result({ mode: 'daily', correct: 10 })).unlocked).not.toContain('perfect10');
  });

  it('Hard Mode Hero: Classic 10/10 on Hard also unlocks Perfect 10', () => {
    const hard = { quiz: 'flags', region: 'all', difficulty: 'hard', direction: 'flag' } as const;
    expect(evaluate(started(), result({ correct: 10, setup: hard })).unlocked).toEqual(['perfect10', 'hardModeHero']);
    expect(evaluate(started(), result({ correct: 9, setup: hard })).unlocked).toEqual([]);
  });

  it('Streaks: bestStreak 25 unlocks On Fire and Unstoppable; 10 only On Fire', () => {
    const r = result({ mode: 'survival', correct: 25, answered: 28, bestStreak: 25, endReason: 'lives' });
    expect(evaluate(started(), r).unlocked).toEqual(['onFire', 'unstoppable', 'survivor']);
    expect(evaluate(started(), result({ mode: 'timeAttack', correct: 12, bestStreak: 10 })).unlocked).toEqual(['onFire']);
    expect(evaluate(started(), result({ bestStreak: 9 })).unlocked).toEqual([]);
  });

  it('Speed Demon at 20 correct in one Time Attack; Survivor at 25 in one Survival', () => {
    const ta = (correct: number) => result({ mode: 'timeAttack', correct, answered: correct + 5, endReason: 'time' });
    const sv = (correct: number) => result({ mode: 'survival', correct, answered: correct + 3, endReason: 'lives' });
    expect(evaluate(started(), ta(20)).unlocked).toEqual(['speedDemon']);
    expect(evaluate(started(), ta(19)).unlocked).toEqual([]);
    expect(evaluate(started(), sv(25)).unlocked).toEqual(['survivor']);
    expect(evaluate(started(), sv(24)).unlocked).toEqual([]);
    // Not cross-mode.
    expect(evaluate(started(), sv(30)).unlocked).not.toContain('speedDemon');
  });

  it('Daily Habit: unlocks when finishing a Daily makes the Daily Streak 7', () => {
    let progress = started();
    for (let i = 6; i >= 1; i--) progress = recordDaily(progress, addDays(TODAY, -i), result({ mode: 'daily' }));
    const daily = result({ mode: 'daily', correct: 4 });
    // 6 days: not yet.
    expect(evaluate(progress, daily, addDays(TODAY, -1)).unlocked).toEqual([]);
    progress = recordDaily(progress, TODAY, daily);
    expect(evaluate(progress, daily).unlocked).toEqual(['dailyHabit']);
    // A non-Daily Round does not unlock it, even with the streak in place.
    expect(evaluate(progress, result({})).unlocked).toEqual([]);
  });

  it('Continental: unlocks when the last Oceania country is Mastered', () => {
    const oceania = poolFor('oceania');
    let progress = collect(started(), oceania.slice(0, -1), 3);
    progress = collect(progress, oceania.slice(-1), 2);
    expect(evaluate(progress, result({})).unlocked).toEqual([]);
    progress = collect(progress, oceania.slice(-1), 1);
    expect(evaluate(progress, result({})).unlocked).toEqual(['continental']);
  });

  it('Collectors: unlock as the Collected count crosses 50 / 100 / 193', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(evaluate(collect(started(), codes.slice(0, 49)), result({})).unlocked).toEqual([]);
    expect(evaluate(collect(started(), codes.slice(0, 50)), result({})).unlocked).toEqual(['collector50']);
    expect(evaluate(collect(started(), codes.slice(0, 100)), result({})).unlocked).toEqual(['collector50', 'collector100']);
    expect(evaluate(collect(started(), codes), result({})).unlocked).toEqual(['collector50', 'collector100', 'collector193']);
  });

  it('several at once: all returned in order with the same date', () => {
    const hard = { quiz: 'flags', region: 'all', difficulty: 'hard', direction: 'flag' } as const;
    const out = evaluate(emptyProgress(), result({ correct: 10, bestStreak: 10, setup: hard }));
    expect(out.unlocked).toEqual(['firstSteps', 'perfect10', 'onFire', 'hardModeHero']);
    for (const id of out.unlocked) expect(out.progress.achievements[id]).toEqual({ unlockedAt: AT });
    expect(unlockedCount(out.progress)).toBe(4);
  });
});

describe('parseAchievements', () => {
  it('keeps known ids with a valid date and drops the rest', () => {
    expect(
      parseAchievements({
        firstSteps: { unlockedAt: AT },
        perfect10: { unlockedAt: 'not a date' },
        onFire: { unlockedAt: '' },
        bogus: { unlockedAt: AT },
        survivor: true,
        speedDemon: { unlockedAt: 5 },
      }),
    ).toEqual({ firstSteps: { unlockedAt: AT } });
  });

  it('gives no Achievements for a missing or corrupt part', () => {
    for (const value of [undefined, null, 'x', 7, [AT]]) expect(parseAchievements(value)).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import {
  bestKey,
  emptyProgress,
  getBest,
  LEGACY_BEST_SCORE_KEY,
  loadProgress,
  PROGRESS_KEY,
  recordBest,
  recordDaily,
  resetProgress,
  saveProgress,
  type KeyValueStore,
} from './progress';
import type { RoundResult } from './round';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const brokenStore: KeyValueStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

const result = (over: Partial<RoundResult>): RoundResult => ({
  mode: 'classic',
  setup: { quiz: 'flags', region: 'all', difficulty: 'normal', direction: 'flag' },
  points: 0,
  correct: 0,
  answered: 0,
  bestStreak: 0,
  missed: [],
  results: [],
  answers: [],
  finished: true,
  endReason: 'questions',
  ...over,
});

describe('bestKey', () => {
  it('includes Region, Difficulty and Direction with v2 defaults', () => {
    expect(bestKey('classic')).toBe('classic|all|normal|flag');
    expect(bestKey('survival', 'europe', 'hard', 'name')).toBe('survival|europe|hard|name');
  });
});

describe('Bests per setup', () => {
  it('stores Survival / Asia / Hard / Reverse under its own key, apart from the default setup', () => {
    const setup = { quiz: 'flags', region: 'asia', difficulty: 'hard', direction: 'name' } as const;
    let progress = emptyProgress();
    progress = recordBest(progress, result({ mode: 'survival', correct: 5, points: 900, endReason: 'lives' })).progress;
    const out = recordBest(progress, result({ mode: 'survival', setup, correct: 3, points: 500, endReason: 'lives' }));
    expect(out.isNewBest).toBe(true);
    expect(out.progress.bests['survival|asia|hard|name']).toEqual({ points: 500, correct: 3, bestStreak: 0 });
    expect(out.progress.bests['survival|all|normal|flag']).toEqual({ points: 900, correct: 5, bestStreak: 0 });
    expect(getBest(out.progress, 'survival', setup)?.correct).toBe(3);
    expect(getBest(out.progress, 'survival')?.correct).toBe(5);
    expect(getBest(out.progress, 'survival', { region: 'europe' })).toBeUndefined();
  });

  it('reads an unknown setup as the defaults', () => {
    const progress = emptyProgress();
    progress.bests[bestKey('classic')] = { points: 1500, correct: 9, bestStreak: 9 };
    expect(getBest(progress, 'classic', { region: 'mars' as never, direction: 'up' as never })?.points).toBe(1500);
  });

  it('keeps existing v2 Bests for All / Normal / Flag → Name and drops keys with an unknown setup', () => {
    const stored = {
      v: 2,
      bests: {
        'classic|all|normal|flag': { points: 1500, correct: 9, bestStreak: 9 },
        'classic|mars|normal|flag': { points: 1, correct: 1, bestStreak: 0 },
        'classic|all|easy|flag': { points: 1, correct: 1, bestStreak: 0 },
        'classic|all|normal|flag|x': { points: 1, correct: 1, bestStreak: 0 },
        classic: { points: 1, correct: 1, bestStreak: 0 },
      },
    };
    const progress = loadProgress(memoryStore({ [PROGRESS_KEY]: JSON.stringify(stored) }));
    expect(Object.keys(progress.bests)).toEqual(['classic|all|normal|flag']);
    expect(getBest(progress, 'classic', { quiz: 'flags', region: 'all', difficulty: 'normal', direction: 'flag' })?.points).toBe(1500);
  });
});

describe('loadProgress', () => {
  it('returns empty progress when nothing is stored', () => {
    expect(loadProgress(memoryStore())).toEqual({ v: 2, bests: {}, daily: {}, passport: {}, achievements: {}, xp: 0, history: [], roundsPlayed: 0 });
  });

  it('migrates the v1 best "7" to a 700-point Classic Best and removes the v1 key', () => {
    const store = memoryStore({ [LEGACY_BEST_SCORE_KEY]: '7' });
    const progress = loadProgress(store);
    expect(getBest(progress, 'classic')).toEqual({ points: 700, correct: 7, bestStreak: 0 });
    expect(store.data.has(LEGACY_BEST_SCORE_KEY)).toBe(false);
    expect(JSON.parse(store.data.get(PROGRESS_KEY) as string)).toEqual(progress);
    // Loading again reads the v2 data.
    expect(loadProgress(store)).toEqual(progress);
  });

  it('ignores a corrupt v1 value', () => {
    for (const raw of ['abc', '-1', '11', '2.5', '']) {
      expect(loadProgress(memoryStore({ [LEGACY_BEST_SCORE_KEY]: raw }))).toEqual(emptyProgress());
    }
  });

  it('prefers existing v2 data over the v1 key', () => {
    const v2 = { v: 2, bests: { [bestKey('classic')]: { points: 1500, correct: 9, bestStreak: 9 } } };
    const store = memoryStore({ [PROGRESS_KEY]: JSON.stringify(v2), [LEGACY_BEST_SCORE_KEY]: '3' });
    expect(loadProgress(store)).toEqual({ ...v2, daily: {}, passport: {}, achievements: {}, xp: 0, history: [], roundsPlayed: 0 });
    expect(store.data.has(LEGACY_BEST_SCORE_KEY)).toBe(false);
  });

  it('falls back to defaults on corrupt v2 data and drops invalid entries', () => {
    expect(loadProgress(memoryStore({ [PROGRESS_KEY]: '{not json' }))).toEqual(emptyProgress());
    expect(loadProgress(memoryStore({ [PROGRESS_KEY]: '{"v":9}' }))).toEqual(emptyProgress());
    const mixed = {
      v: 2,
      bests: {
        'classic|all|normal|flag': { points: 900, correct: 6 },
        'bogus|all|normal|flag': { points: 1, correct: 1 },
        'survival|all|normal|flag': { points: 'x', correct: 3 },
      },
    };
    expect(loadProgress(memoryStore({ [PROGRESS_KEY]: JSON.stringify(mixed) }))).toEqual({
      v: 2,
      bests: { 'classic|all|normal|flag': { points: 900, correct: 6, bestStreak: 0 } },
      daily: {},
      passport: {},
      achievements: {},
      xp: 0,
      history: [],
      roundsPlayed: 0,
    });
  });

  it('survives storage that throws', () => {
    expect(loadProgress(brokenStore)).toEqual(emptyProgress());
    expect(saveProgress(brokenStore, emptyProgress())).toBe(false);
    expect(resetProgress(brokenStore)).toEqual(emptyProgress());
  });
});

describe('recordBest', () => {
  it('compares Survival on correct answers and Classic on Points', () => {
    let progress = emptyProgress();
    progress.bests[bestKey('survival')] = { points: 9000, correct: 30, bestStreak: 5 };
    progress.bests[bestKey('classic')] = { points: 1500, correct: 8, bestStreak: 4 };

    const survival = recordBest(progress, result({ mode: 'survival', correct: 41, points: 5000, endReason: 'lives' }));
    expect(survival.isNewBest).toBe(true);
    expect(getBest(survival.progress, 'survival')).toMatchObject({ correct: 41, points: 5000 });

    const classic = recordBest(survival.progress, result({ mode: 'classic', points: 1200, correct: 10 }));
    expect(classic.isNewBest).toBe(false);
    expect(classic.progress).toBe(survival.progress);
    progress = classic.progress;
    expect(getBest(progress, 'classic')?.points).toBe(1500);
  });

  it('breaks a Survival tie on correct answers with higher Points', () => {
    const progress = emptyProgress();
    progress.bests[bestKey('survival')] = { points: 3000, correct: 20, bestStreak: 5 };
    const lower = recordBest(progress, result({ mode: 'survival', correct: 20, points: 2500, endReason: 'lives' }));
    expect(lower).toEqual({ progress, isNewBest: false });
    const equal = recordBest(progress, result({ mode: 'survival', correct: 20, points: 3000, endReason: 'lives' }));
    expect(equal.isNewBest).toBe(false);
    const higher = recordBest(progress, result({ mode: 'survival', correct: 20, points: 3600, endReason: 'lives' }));
    expect(higher.isNewBest).toBe(true);
    expect(getBest(higher.progress, 'survival')).toMatchObject({ correct: 20, points: 3600 });
  });

  it('does not update Bests for a quit Round', () => {
    const progress = emptyProgress();
    const out = recordBest(progress, result({ mode: 'timeAttack', points: 5000, finished: false, endReason: null }));
    expect(out).toEqual({ progress, isNewBest: false });
  });

  it('stores a first 0-point Round without calling it a new Best', () => {
    const out = recordBest(emptyProgress(), result({ points: 0 }));
    expect(out.isNewBest).toBe(false);
    expect(getBest(out.progress, 'classic')).toEqual({ points: 0, correct: 0, bestStreak: 0 });
    expect(recordBest(out.progress, result({ points: 100, correct: 1 })).isNewBest).toBe(true);
  });

  it('round-trips through save and load', () => {
    const store = memoryStore();
    const { progress } = recordBest(emptyProgress(), result({ mode: 'timeAttack', points: 2400, correct: 14 }));
    expect(saveProgress(store, progress)).toBe(true);
    expect(loadProgress(store)).toEqual(progress);
  });
});

describe('resetProgress', () => {
  it('clears Bests and the v1 key but keeps other keys such as the Locale', () => {
    const store = memoryStore({
      [PROGRESS_KEY]: JSON.stringify({ v: 2, bests: { 'classic|all|normal|flag': { points: 1, correct: 1 } } }),
      [LEGACY_BEST_SCORE_KEY]: '5',
      'flag-quiz:locale': 'tr',
    });
    expect(resetProgress(store)).toEqual(emptyProgress());
    expect(loadProgress(store)).toEqual(emptyProgress());
    expect(store.data.get('flag-quiz:locale')).toBe('tr');
  });
});

const daily = (correct: number, points = correct * 150): RoundResult =>
  result({
    mode: 'daily',
    correct,
    answered: 10,
    points,
    results: Array.from({ length: 10 }, (_, i) => i < correct),
  });

describe('recordDaily', () => {
  it('saves {points, correct, results} for the Daily Date and keeps Bests', () => {
    const start = recordBest(emptyProgress(), result({ points: 900, correct: 6 })).progress;
    const out = recordDaily(start, '2026-11-20', daily(8, 1240));
    expect(out.daily['2026-11-20']).toEqual({ points: 1240, correct: 8, results: daily(8).results });
    expect(out.bests).toBe(start.bests);
  });

  it('records only the first scored attempt per Daily Date', () => {
    const first = recordDaily(emptyProgress(), '2026-11-20', daily(3));
    expect(recordDaily(first, '2026-11-20', daily(10))).toBe(first);
  });

  it('records nothing for a quit Daily or a non-Daily Round', () => {
    const progress = emptyProgress();
    expect(recordDaily(progress, '2026-11-20', { ...daily(3), finished: false, endReason: null })).toBe(progress);
    expect(recordDaily(progress, '2026-11-20', result({ mode: 'classic' }))).toBe(progress);
  });

  it('throws on a malformed key', () => {
    expect(() => recordDaily(emptyProgress(), '2026-13-01', daily(3))).toThrow(/YYYY-MM-DD/);
  });

  it('updates the Daily Best through recordBest', () => {
    const { progress, isNewBest } = recordBest(emptyProgress(), daily(8, 1240));
    expect(isNewBest).toBe(true);
    expect(getBest(progress, 'daily')).toMatchObject({ points: 1240, correct: 8 });
  });

  it('round-trips through save and load', () => {
    const store = memoryStore();
    const progress = recordDaily(emptyProgress(), '2026-11-20', daily(8, 1240));
    saveProgress(store, progress);
    expect(loadProgress(store)).toEqual(progress);
  });
});

describe('loadProgress Daily part', () => {
  const bests = { 'classic|all|normal|flag': { points: 900, correct: 6, bestStreak: 2 } };

  it('loads older v2 data without Daily fields with an empty history and Bests intact', () => {
    const progress = loadProgress(memoryStore({ [PROGRESS_KEY]: JSON.stringify({ v: 2, bests }) }));
    expect(progress).toEqual({ v: 2, bests, daily: {}, passport: {}, achievements: {}, xp: 0, history: [], roundsPlayed: 0 });
  });

  it('gives an empty history for a corrupt Daily part and keeps Bests', () => {
    for (const daily of ['nope', 42, null, [1, 2]]) {
      const progress = loadProgress(memoryStore({ [PROGRESS_KEY]: JSON.stringify({ v: 2, bests, daily }) }));
      expect(progress).toEqual({ v: 2, bests, daily: {}, passport: {}, achievements: {}, xp: 0, history: [], roundsPlayed: 0 });
    }
  });

  it('drops invalid Daily entries and keeps valid ones', () => {
    const ten = (correct: number) => Array.from({ length: 10 }, (_, i) => i < correct);
    const ok = { points: 300, correct: 2, results: ten(2) };
    const raw = {
      v: 2,
      bests,
      daily: {
        '2026-11-20': ok,
        '2026-02-30': ok, // not a real date
        'today': ok,
        '2026-11-21': { points: 300, correct: 5, results: ten(4) }, // correct mismatch
        '2026-11-22': { points: -1, correct: 0, results: ten(0) },
        '2026-11-23': { points: 1, correct: 0, results: [...ten(0).slice(1), 'x'] },
        '2026-11-24': { points: 100, correct: 1, results: [true] }, // not 10 Questions
        '2026-11-25': { points: 100, correct: 1, results: [...ten(1), false] }, // 11
      },
    };
    expect(loadProgress(memoryStore({ [PROGRESS_KEY]: JSON.stringify(raw) })).daily).toEqual({ '2026-11-20': ok });
  });

  it('resetProgress also clears the Daily history', () => {
    const store = memoryStore();
    saveProgress(store, recordDaily(emptyProgress(), '2026-11-20', daily(8)));
    expect(resetProgress(store).daily).toEqual({});
    expect(loadProgress(store).daily).toEqual({});
  });
});

describe('loadProgress Passport and Achievements parts', () => {
  const bests = { 'classic|all|normal|flag': { points: 900, correct: 6, bestStreak: 2 } };
  const ten = Array.from({ length: 10 }, (_, i) => i < 2);
  const daily = { '2026-11-20': { points: 300, correct: 2, results: ten } };

  it('loads older v2 data without the new fields with an empty Passport and Achievements, Bests and Daily intact', () => {
    const progress = loadProgress(memoryStore({ [PROGRESS_KEY]: JSON.stringify({ v: 2, bests, daily }) }));
    expect(progress).toEqual({ v: 2, bests, daily, passport: {}, achievements: {}, xp: 0, history: [], roundsPlayed: 0 });
  });

  it('drops a corrupt Passport or Achievements part and keeps Bests and Daily', () => {
    for (const bad of ['nope', 42, null, [1, 2]]) {
      const raw = { v: 2, bests, daily, passport: bad, achievements: bad };
      const progress = loadProgress(memoryStore({ [PROGRESS_KEY]: JSON.stringify(raw) }));
      expect(progress).toEqual({ v: 2, bests, daily, passport: {}, achievements: {}, xp: 0, history: [], roundsPlayed: 0 });
    }
  });

  it('keeps valid entries next to invalid ones', () => {
    const raw = {
      v: 2,
      bests,
      passport: { fr: { correct: 3, seen: 4 }, zz: { correct: 1, seen: 1 } },
      achievements: { firstSteps: { unlockedAt: '2026-11-20T09:00:00.000Z' }, nope: { unlockedAt: '2026-11-20' } },
    };
    const progress = loadProgress(memoryStore({ [PROGRESS_KEY]: JSON.stringify(raw) }));
    expect(progress.passport).toEqual({ fr: { correct: 3, seen: 4 } });
    expect(progress.achievements).toEqual({ firstSteps: { unlockedAt: '2026-11-20T09:00:00.000Z' } });
    expect(progress.bests).toEqual(bests);
  });

  it('round-trips through save and load', () => {
    const store = memoryStore();
    const progress = {
      ...emptyProgress(),
      passport: { jp: { correct: 1, seen: 2 } },
      achievements: { firstSteps: { unlockedAt: '2026-11-20T09:00:00.000Z' } },
    };
    saveProgress(store, progress);
    expect(loadProgress(store)).toEqual(progress);
  });

  it('resetProgress clears the Passport and Achievements', () => {
    const store = memoryStore();
    saveProgress(store, {
      ...emptyProgress(),
      passport: { jp: { correct: 3, seen: 3 } },
      achievements: { firstSteps: { unlockedAt: '2026-11-20T09:00:00.000Z' } },
    });
    const reset = resetProgress(store);
    expect(reset.passport).toEqual({});
    expect(reset.achievements).toEqual({});
    expect(loadProgress(store)).toEqual(emptyProgress());
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { COUNTRIES } from './countries';
import { countryName } from './i18n';
import {
  addDays,
  createDailyRound,
  DAILY_EPOCH,
  dailyNumber,
  dailySeed,
  dailyStreak,
  isDateKey,
  shareText,
} from './daily';
import type { DailyEntry } from './progress';
import { answerRound, getRoundResult, nextQuestion, type RoundState } from './round';

const entry: DailyEntry = { points: 100, correct: 1, results: [true] };
const fmt = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);

function playAll(state: RoundState, correctCount: number): RoundState {
  let s = state;
  for (let i = 0; i < 10; i++) {
    const pick = i < correctCount ? s.question.answer : (s.question.options.find((o) => o !== s.question.answer) as string);
    s = answerRound(s, pick, 1000 * i);
    s = nextQuestion(s, 1000 * i + 500);
  }
  return s;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isDateKey', () => {
  it('accepts real YYYY-MM-DD dates only', () => {
    expect(isDateKey('2026-11-20')).toBe(true);
    expect(isDateKey('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-01', '26-11-20', '2026/11/20', '', null, 20261120]) {
      expect(isDateKey(bad)).toBe(false);
    }
  });
});

describe('dailyNumber', () => {
  it('is days since the epoch + 1', () => {
    expect(DAILY_EPOCH).toBe('2026-11-07');
    expect(dailyNumber('2026-11-07')).toBe(1);
    expect(dailyNumber('2026-11-20')).toBe(14);
    expect(dailyNumber('2027-11-07')).toBe(366);
  });

  it('gives 1 before the epoch and throws a clear error on a malformed key', () => {
    expect(dailyNumber('2020-01-01')).toBe(1);
    expect(() => dailyNumber('2026-11-32')).toThrow(/Invalid Daily Date key "2026-11-32".*YYYY-MM-DD/);
    expect(() => dailyNumber('tomorrow')).toThrow(/YYYY-MM-DD/);
  });
});

describe('addDays', () => {
  it('does calendar maths across months, years, leap days and DST changes', () => {
    expect(addDays('2026-11-20', 1)).toBe('2026-11-21');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // EU DST start
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // US DST end
    expect(addDays('2026-11-20', -13)).toBe(DAILY_EPOCH);
  });
});

describe('createDailyRound', () => {
  it('is deterministic: same key gives the same answers and Options in the same order', () => {
    const a = createDailyRound('2026-11-20', 0);
    const b = createDailyRound('2026-11-20', 99_999);
    expect(a.order).toEqual(b.order);
    expect(playAll(a, 4).history).toEqual(playAll(b, 4).history);
    // Every Question, Options included, matches.
    let x = a;
    let y = b;
    for (let i = 0; i < 10; i++) {
      expect(x.question).toEqual(y.question);
      x = nextQuestion(answerRound(x, x.question.answer, 0), 0);
      y = nextQuestion(answerRound(y, y.question.answer, 0), 0);
    }
  });

  it('never uses Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    const s = playAll(createDailyRound('2026-11-20', 0), 5);
    expect(spy).not.toHaveBeenCalled();
    expect(s.finished).toBe(true);
  });

  it('gives different answers on different days', () => {
    expect(createDailyRound('2026-11-20', 0).order).not.toEqual(createDailyRound('2026-11-21', 0).order);
  });

  it('golden: pins the 2026-11-20 Round so mobile must match', () => {
    expect(dailySeed('2026-11-20')).toBe(102300637);
    const s = createDailyRound('2026-11-20', 0);
    expect(s.order).toEqual(['vn', 'ws', 'li', 'ke', 'so', 'ec', 'st', 'sk', 'cz', 'gb']);
    expect(s.question).toEqual({ answer: 'vn', options: ['cy', 'au', 'kg', 'vn'] });
    expect(COUNTRIES).toHaveLength(193);
  });

  it('plays with Classic rules: 10 unique answers, Speed Bonus and Streak, ends after the 10th', () => {
    const s0 = createDailyRound('2026-11-20', 0);
    expect(s0).toMatchObject({ mode: 'daily', lives: null, deadlineMs: null });
    expect(new Set(s0.order).size).toBe(10);
    const s1 = answerRound(s0, s0.question.answer, 2000);
    expect(s1.points).toBe(140);
    const done = playAll(s0, 8);
    expect(done.finished).toBe(true);
    expect(done.endReason).toBe('questions');
    const result = getRoundResult(done);
    expect(result).toMatchObject({ mode: 'daily', correct: 8, answered: 10 });
    expect(result.results).toEqual([true, true, true, true, true, true, true, true, false, false]);
  });

  it('throws on a malformed key', () => {
    expect(() => createDailyRound('2026-11-20T00:00', 0)).toThrow(/YYYY-MM-DD/);
  });
});

describe('dailyStreak', () => {
  const today = '2026-11-20';

  it('counts today, yesterday and the day before', () => {
    expect(dailyStreak({ '2026-11-20': entry, '2026-11-19': entry, '2026-11-18': entry }, today)).toBe(3);
  });

  it('is still alive from yesterday until today ends', () => {
    expect(dailyStreak({ '2026-11-19': entry, '2026-11-17': entry }, today)).toBe(1);
  });

  it('is broken when the last entry is 2 days ago', () => {
    expect(dailyStreak({ '2026-11-18': entry, '2026-11-17': entry }, today)).toBe(0);
    expect(dailyStreak({}, today)).toBe(0);
  });

  it('counts across a month boundary', () => {
    expect(dailyStreak({ '2026-12-01': entry, '2026-11-30': entry, '2026-11-29': entry }, '2026-12-01')).toBe(3);
  });
});

describe('shareText', () => {
  const results = [true, true, false, true, true, true, false, true, true, true];
  const base = { number: 14, results, correct: 8, total: 10, points: 1240, url: 'https://flags.example', formatNumber: fmt };

  it('builds the English share text', () => {
    expect(shareText({ ...base, locale: 'en' })).toBe(
      'Flag Quiz Daily #14\n🟩🟩🟥🟩🟩🟩🟥🟩🟩🟩\n8/10 · 1,240 pts\nhttps://flags.example',
    );
  });

  it('builds the Turkish share text', () => {
    expect(shareText({ ...base, locale: 'tr' })).toBe(
      'Bayrak Quiz Günlük #14\n🟩🟩🟥🟩🟩🟩🟥🟩🟩🟩\n8/10 · 1.240 puan\nhttps://flags.example',
    );
  });

  it('accepts translated templates', () => {
    const text = shareText({ ...base, locale: 'en', templates: { title: 'Daily {{number}}', score: '{{correct}} of {{total}}' } });
    expect(text.split('\n').slice(0, 1)).toEqual(['Daily 14']);
    expect(text).toContain('8 of 10');
  });

  it('contains no country names', () => {
    const s = playAll(createDailyRound('2026-11-20', 0), 8);
    const r = getRoundResult(s);
    for (const locale of ['en', 'tr'] as const) {
      const text = shareText({ ...base, locale, results: r.results, correct: r.correct, points: r.points });
      for (const code of s.order) {
        expect(text).not.toContain(countryName(code, locale));
      }
    }
  });
});

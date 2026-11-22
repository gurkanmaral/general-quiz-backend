import { describe, expect, it } from 'vitest';
import { COUNTRIES } from './countries';
import { parsePassport, passportTotals, recordAnswers, stateOf } from './passport';
import { emptyProgress } from './progress';
import { poolFor } from './regions';

const ok = (code: string) => ({ code, correct: true });
const miss = (code: string) => ({ code, correct: false });

describe('stateOf', () => {
  it('is none below 1 correct, collected from 1, mastered from 3', () => {
    expect(stateOf(undefined)).toBe('none');
    expect(stateOf({ correct: 0, seen: 4 })).toBe('none');
    expect(stateOf({ correct: 1, seen: 1 })).toBe('collected');
    expect(stateOf({ correct: 2, seen: 9 })).toBe('collected');
    expect(stateOf({ correct: 3, seen: 3 })).toBe('mastered');
    expect(stateOf({ correct: 12, seen: 20 })).toBe('mastered');
  });
});

describe('recordAnswers', () => {
  it('collects a country on its first correct answer', () => {
    const progress = recordAnswers(emptyProgress(), [ok('fr')]);
    expect(progress.passport.fr).toEqual({ correct: 1, seen: 1 });
    expect(stateOf(progress.passport.fr)).toBe('collected');
  });

  it('masters a country on its 3rd correct answer across Rounds; wrong answers never reduce the count', () => {
    let progress = recordAnswers(emptyProgress(), [ok('fr'), miss('de')]);
    progress = recordAnswers(progress, [miss('fr'), ok('fr')]);
    expect(stateOf(progress.passport.fr)).toBe('collected');
    progress = recordAnswers(progress, [miss('fr'), miss('fr')]);
    expect(progress.passport.fr).toEqual({ correct: 2, seen: 5 });
    progress = recordAnswers(progress, [ok('fr')]);
    expect(progress.passport.fr).toEqual({ correct: 3, seen: 6 });
    expect(stateOf(progress.passport.fr)).toBe('mastered');
    expect(progress.passport.de).toEqual({ correct: 0, seen: 1 });
    expect(stateOf(progress.passport.de)).toBe('none');
  });

  it('counts Reverse (Name → Flag) answers for the answer country like any other', () => {
    // The Passport records the answer country only, whatever the Direction.
    const progress = recordAnswers(emptyProgress(), [ok('jp')]);
    expect(stateOf(progress.passport.jp)).toBe('collected');
  });

  it('is pure, ignores unknown codes and returns the same object for no answers', () => {
    const start = emptyProgress();
    expect(recordAnswers(start, [])).toBe(start);
    expect(recordAnswers(start, [ok('xx')])).toBe(start);
    const next = recordAnswers(start, [ok('FR'), ok('xx')]);
    expect(next.passport).toEqual({ fr: { correct: 1, seen: 1 } });
    expect(start.passport).toEqual({});
  });
});

describe('passportTotals', () => {
  it('counts Collected (mastered included) and Mastered per Region', () => {
    let progress = emptyProgress();
    progress = recordAnswers(progress, [ok('fr'), ok('fr'), ok('fr'), ok('de'), ok('jp'), miss('it')]);
    expect(passportTotals(progress)).toEqual({ total: 193, collected: 3, mastered: 1 });
    expect(passportTotals(progress, 'europe')).toEqual({ total: poolFor('europe').length, collected: 2, mastered: 1 });
    expect(passportTotals(progress, 'asia')).toMatchObject({ collected: 1, mastered: 0 });
    expect(passportTotals(progress, 'africa')).toMatchObject({ collected: 0, mastered: 0 });
  });

  it('reaches 193 / 193 when every country is collected', () => {
    const progress = recordAnswers(emptyProgress(), COUNTRIES.map((c) => ok(c.code)));
    expect(passportTotals(progress)).toEqual({ total: 193, collected: 193, mastered: 0 });
  });
});

describe('parsePassport', () => {
  it('keeps valid entries and drops unknown codes, bad counts and correct > seen', () => {
    expect(
      parsePassport({
        fr: { correct: 2, seen: 3 },
        jp: { correct: 0, seen: 1 },
        xx: { correct: 1, seen: 1 },
        FR: { correct: 1, seen: 1 },
        de: { correct: 4, seen: 3 },
        it: { correct: -1, seen: 3 },
        es: { correct: 1.5, seen: 3 },
        pt: 'nope',
        gb: null,
      }),
    ).toEqual({ fr: { correct: 2, seen: 3 }, jp: { correct: 0, seen: 1 } });
  });

  it('gives an empty Passport for a missing or corrupt part', () => {
    for (const value of [undefined, null, 'x', 42, [1, 2]]) expect(parsePassport(value)).toEqual({});
  });
});

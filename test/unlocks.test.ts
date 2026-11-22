import { describe, expect, it } from 'vitest';
import type { QuestionDifficulty } from '../src/contracts';
import { describeUnlockRule, isRuleMet, type RuleContext } from '../src/modules/progress';

// A Quiz with 4 Standard (s1–s4) and 2 Expert (e1, e2) published Questions.
const published = new Map<string, QuestionDifficulty>([
  ['s1', 'standard'],
  ['s2', 'standard'],
  ['s3', 'standard'],
  ['s4', 'standard'],
  ['e1', 'expert'],
  ['e2', 'expert'],
]);
const context = (correct: string[], gamesWon = 0): RuleContext => ({ correct: new Set(correct), published, gamesWon });

describe('Unlock Rule evaluator (Story 3.1, AD-10)', () => {
  it('correctShare: met at or above the share of all published Questions', () => {
    const rule = { type: 'correctShare', min: 0.5 } as const;
    expect(isRuleMet(rule, context(['s1', 's2', 'e1']))).toBe(true); // 3/6
    expect(isRuleMet(rule, context(['s1', 's2']))).toBe(false); // 2/6
    // Questions no longer published do not count.
    expect(isRuleMet(rule, context(['s1', 's2', 'gone']))).toBe(false);
  });

  it('correctShare with a Difficulty counts only that Difficulty', () => {
    const rule = { type: 'correctShare', min: 0.5, difficulty: 'expert' } as const;
    expect(isRuleMet(rule, context(['e1']))).toBe(true);
    expect(isRuleMet(rule, context(['s1', 's2', 's3', 's4']))).toBe(false);
  });

  it('allCorrect: met only when every Question of the Difficulty was answered correctly', () => {
    const rule = { type: 'allCorrect', difficulty: 'expert' } as const;
    expect(isRuleMet(rule, context(['e1', 'e2']))).toBe(true);
    expect(isRuleMet(rule, context(['e1', 's1', 's2', 's3', 's4']))).toBe(false);
  });

  it('a rule over no published Questions is never met', () => {
    const empty: RuleContext = { correct: new Set(['x']), published: new Map(), gamesWon: 0 };
    expect(isRuleMet({ type: 'allCorrect', difficulty: 'expert' }, empty)).toBe(false);
    expect(isRuleMet({ type: 'correctShare', min: 0.1 }, empty)).toBe(false);
    expect(isRuleMet({ type: 'allCorrect', difficulty: 'expert' }, { ...context([]), published: new Map([['s1', 'standard']]) })).toBe(false);
  });

  it('gamesWon: met at or above the number of games won', () => {
    expect(isRuleMet({ type: 'gamesWon', min: 3 }, context([], 3))).toBe(true);
    expect(isRuleMet({ type: 'gamesWon', min: 3 }, context([], 2))).toBe(false);
  });

  it('describes how to earn each rule type', () => {
    expect(describeUnlockRule({ type: 'correctShare', min: 0.8 })).toBe("Answer 80% of this quiz's questions correctly (across all your games).");
    expect(describeUnlockRule({ type: 'correctShare', min: 0.5, difficulty: 'expert' })).toMatch(/50% of this quiz's Expert questions/);
    expect(describeUnlockRule({ type: 'allCorrect', difficulty: 'expert' })).toBe('Answer every Expert question of this quiz correctly at least once.');
    expect(describeUnlockRule({ type: 'gamesWon', min: 1 })).toBe('Win 1 game of this quiz (70% or more correct).');
  });
});

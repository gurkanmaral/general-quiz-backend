import { describe, expect, it } from 'vitest';
import { DailyDateSchema, DailyResponseSchema, isCalendarDate, localize, rarityLabel, UnlockRuleSchema } from './index';

describe('contracts', () => {
  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isCalendarDate('2026-11-16')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '20261116', '2026-1-16', 'abc', '']) {
      expect(isCalendarDate(bad)).toBe(false);
      expect(DailyDateSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('falls back to English for a missing translation', () => {
    expect(localize({ en: 'Hello' }, 'tr')).toBe('Hello');
    expect(localize({ en: 'Hello', tr: 'Merhaba' }, 'tr')).toBe('Merhaba');
  });

  it('rejects a Daily question without four options', () => {
    const text = { en: 'x' };
    const question = {
      slug: 's', category: 'Science', theme: 'cyan', eyebrow: text, text, options: [text, text, text],
      correctIndex: 0, answerTitle: text, summary: text, facts: [],
      video: { title: text, creator: 'c', url: 'https://example.com' }, source: { label: text, url: 'https://example.com' },
    };
    expect(DailyResponseSchema.safeParse({ dailyDate: '2026-11-16', question }).success).toBe(false);
    expect(DailyResponseSchema.safeParse({ dailyDate: '2026-11-16', question: { ...question, options: [text, text, text, text] } }).success).toBe(true);
  });

  it('labels Rarity with a "<1%" floor (FR-19)', () => {
    expect(rarityLabel(null)).toBe('New');
    expect(rarityLabel(0)).toBe('<1%');
    expect(rarityLabel(0.99)).toBe('<1%');
    expect(rarityLabel(1)).toBe('1%');
    expect(rarityLabel(12.4)).toBe('12%');
    expect(rarityLabel(100)).toBe('100%');
  });

  it('accepts only the closed set of Unlock Rule types (AD-10)', () => {
    expect(UnlockRuleSchema.safeParse({ type: 'correctShare', min: 0.8 }).success).toBe(true);
    expect(UnlockRuleSchema.safeParse({ type: 'allCorrect', difficulty: 'expert' }).success).toBe(true);
    expect(UnlockRuleSchema.safeParse({ type: 'gamesWon', min: 3 }).success).toBe(true);
    expect(UnlockRuleSchema.safeParse({ type: 'speedRun', seconds: 3 }).success).toBe(false);
    expect(UnlockRuleSchema.safeParse({ type: 'allCorrect' }).success).toBe(false);
    expect(UnlockRuleSchema.safeParse({ type: 'gamesWon', min: 3, extra: true }).success).toBe(false);
  });
});

import type { QuestionDifficulty, UnlockRule } from '@general-quiz/contracts';

/** What an Unlock Rule is evaluated against: one player's Quiz Record (FR-15, AD-10). */
export type RuleContext = {
  /** Distinct Questions the player has ever answered correctly in the Quiz. */
  correct: ReadonlySet<string>;
  /** The Quiz's published Questions and their Difficulty. */
  published: ReadonlyMap<string, QuestionDifficulty>;
  gamesWon: number;
};

function questionsOf(context: RuleContext, difficulty?: QuestionDifficulty): string[] {
  return [...context.published].filter(([, value]) => !difficulty || value === difficulty).map(([slug]) => slug);
}

/**
 * The one evaluator for every Badge and Title (AD-10). A rule over an empty set of Questions is
 * never met. New rule types are added here (and to `UnlockRuleSchema`), never in content code.
 */
export function isRuleMet(rule: UnlockRule, context: RuleContext): boolean {
  switch (rule.type) {
    case 'correctShare': {
      const pool = questionsOf(context, rule.difficulty);
      if (pool.length === 0) return false;
      return pool.filter((slug) => context.correct.has(slug)).length / pool.length >= rule.min;
    }
    case 'allCorrect': {
      const pool = questionsOf(context, rule.difficulty);
      return pool.length > 0 && pool.every((slug) => context.correct.has(slug));
    }
    case 'gamesWon':
      return context.gamesWon >= rule.min;
  }
}

/** How to earn an item, for unearned Badges and Titles on one's own Profile (FR-20). */
export function describeUnlockRule(rule: UnlockRule): string {
  switch (rule.type) {
    case 'correctShare': {
      const percent = Math.round(rule.min * 100);
      const scope = rule.difficulty ? `of this quiz's ${rule.difficulty === 'expert' ? 'Expert' : 'Standard'} questions` : "of this quiz's questions";
      return percent === 100 ? `Answer every one ${scope} correctly at least once.` : `Answer ${percent}% ${scope} correctly (across all your games).`;
    }
    case 'allCorrect':
      return `Answer every ${rule.difficulty === 'expert' ? 'Expert' : 'Standard'} question of this quiz correctly at least once.`;
    case 'gamesWon':
      return `Win ${rule.min} game${rule.min === 1 ? '' : 's'} of this quiz (70% or more correct).`;
  }
}

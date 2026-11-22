import { describe, expect, it } from 'vitest';
import { COUNTRIES } from './countries';
import { answer, createQuiz, currentQuestion, getResult, next, type QuizState } from './quiz';
import { createSeededRandom } from './random';

const wrongOption = (state: QuizState) => {
  const q = currentQuestion(state);
  return q.options.find((o) => o !== q.answer) as string;
};

describe('createQuiz', () => {
  it('builds N questions with unique answers and 4 unique options including the answer', () => {
    const state = createQuiz({ countries: COUNTRIES, count: 10, random: createSeededRandom(1) });
    expect(state.questions).toHaveLength(10);
    expect(new Set(state.questions.map((q) => q.answer)).size).toBe(10);
    for (const q of state.questions) {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.options).toContain(q.answer);
      expect(q.options.filter((o) => o === q.answer)).toHaveLength(1);
    }
    expect(state).toMatchObject({ index: 0, score: 0, finished: false });
    expect(state.picks).toEqual(Array(10).fill(null));
  });

  it('is deterministic for the same seed', () => {
    const a = createQuiz({ countries: COUNTRIES, count: 10, random: createSeededRandom(42) });
    const b = createQuiz({ countries: COUNTRIES, count: 10, random: createSeededRandom(42) });
    expect(a).toEqual(b);
  });

  it('defaults to 10 questions', () => {
    expect(createQuiz({ countries: COUNTRIES }).questions).toHaveLength(10);
  });

  it('clamps the quiz length to the pool size', () => {
    const pool = COUNTRIES.slice(0, 5);
    const state = createQuiz({ countries: pool, count: 50, random: createSeededRandom(3) });
    expect(state.questions).toHaveLength(5);
    expect(new Set(state.questions.map((q) => q.answer)).size).toBe(5);
  });

  it('throws a clear error naming the minimum when the pool is too small', () => {
    expect(() => createQuiz({ countries: COUNTRIES.slice(0, 3) })).toThrow(/at least 4/);
  });
});

describe('answer / next', () => {
  const fresh = () => createQuiz({ countries: COUNTRIES, count: 3, random: createSeededRandom(7) });

  it('scores a correct answer and marks it', () => {
    const s0 = fresh();
    const s1 = answer(s0, currentQuestion(s0).answer);
    expect(s1.score).toBe(1);
    expect(s1.picks[0]).toBe(currentQuestion(s0).answer);
    expect(s0.score).toBe(0); // immutable
  });

  it('keeps the score on a wrong answer and records the pick', () => {
    const s0 = fresh();
    const wrong = wrongOption(s0);
    const s1 = answer(s0, wrong);
    expect(s1.score).toBe(0);
    expect(s1.picks[0]).toBe(wrong);
    expect(s1.picks[0]).not.toBe(currentQuestion(s1).answer);
  });

  it('ignores a second answer to the same question', () => {
    const s0 = fresh();
    const s1 = answer(s0, wrongOption(s0));
    const s2 = answer(s1, currentQuestion(s1).answer);
    expect(s2).toBe(s1);
    expect(s2.score).toBe(0);
  });

  it('ignores codes that are not options', () => {
    const s0 = fresh();
    expect(answer(s0, 'zz')).toBe(s0);
  });

  it('only advances once the current question is answered', () => {
    const s0 = fresh();
    expect(next(s0)).toBe(s0);
    const s1 = next(answer(s0, currentQuestion(s0).answer));
    expect(s1.index).toBe(1);
  });
});

describe('finishing', () => {
  it('finishes after the last answer and reports score, total and missed countries', () => {
    let s = createQuiz({ countries: COUNTRIES, count: 3, random: createSeededRandom(9) });
    const missedAnswer = currentQuestion(s).answer;
    s = next(answer(s, wrongOption(s)));
    s = next(answer(s, currentQuestion(s).answer));
    expect(s.finished).toBe(false);
    s = answer(s, currentQuestion(s).answer);
    expect(s.finished).toBe(true);
    expect(next(s)).toBe(s);
    expect(answer(s, currentQuestion(s).options[0] as string)).toBe(s);
    expect(getResult(s)).toEqual({ score: 2, total: 3, missed: [missedAnswer] });
  });
});

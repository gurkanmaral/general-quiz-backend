import { describe, expect, it } from 'vitest';
import { COUNTRIES } from './countries';
import { groupOf } from './lookalikes';
import { buildQuestion, type Question } from './quiz';
import { createSeededRandom } from './random';
import { continentOf, poolFor } from './regions';
import { DEFAULT_SETUP, type RoundSetup } from './setup';
import {
  answerRound,
  createRound,
  getRoundResult,
  nextQuestion,
  pause,
  remainingMs,
  resume,
  tick,
  type GameMode,
  type RoundState,
} from './round';

const make = (mode: GameMode, seed = 1, nowMs = 0) =>
  createRound({ mode, countries: COUNTRIES, random: createSeededRandom(seed), nowMs });
const right = (s: RoundState) => s.question.answer;
const wrong = (s: RoundState) => s.question.options.find((o) => o !== s.question.answer) as string;

function expectValidQuestion(s: RoundState) {
  const q = s.question;
  expect(q.options).toHaveLength(4);
  expect(new Set(q.options).size).toBe(4);
  expect(q.options.filter((o) => o === q.answer)).toHaveLength(1);
}

describe('createRound', () => {
  it('starts each mode with its own rules', () => {
    const c = make('classic');
    expect(c).toMatchObject({ mode: 'classic', lives: null, deadlineMs: null, questionNumber: 1, points: 0, streak: 0 });
    expect(c.order).toHaveLength(10);
    expect(make('timeAttack', 1, 500).deadlineMs).toBe(60_500);
    expect(make('survival').lives).toBe(3);
    expectValidQuestion(c);
  });

  it('is deterministic for the same seed', () => {
    let a = make('survival', 42);
    let b = make('survival', 42);
    for (let i = 0; i < 20; i++) {
      expect(a.question).toEqual(b.question);
      a = nextQuestion(answerRound(a, right(a), i * 1000), i * 1000 + 700);
      b = nextQuestion(answerRound(b, right(b), i * 1000), i * 1000 + 700);
    }
  });

  it('needs at least 4 countries', () => {
    expect(() => createRound({ mode: 'classic', countries: COUNTRIES.slice(0, 3), nowMs: 0 })).toThrow(/at least 4/);
  });
});

describe('scoring in a Round', () => {
  it('adds +280 for a correct answer in 2 s that makes the Streak 4', () => {
    let s = make('classic');
    for (let i = 0; i < 3; i++) s = nextQuestion(answerRound(s, right(s), 20_000), 20_000);
    expect(s.streak).toBe(3);
    const before = s.points;
    s = answerRound(s, right(s), 22_000);
    expect(s.streak).toBe(4);
    expect(s.points - before).toBe(280);
    expect(s.history[s.history.length - 1]).toMatchObject({ correct: true, points: 280, streak: 4 });
  });

  it('scores +100 for a slow correct answer at Streak 1', () => {
    const s = answerRound(make('classic'), right(make('classic')), 15_000);
    expect(s.points).toBe(100);
  });

  it('scores 0 and resets the Streak on a wrong answer, keeping the best Streak', () => {
    let s = make('survival');
    for (let i = 0; i < 7; i++) s = nextQuestion(answerRound(s, right(s), 0), 0);
    expect(s.streak).toBe(7);
    const before = s.points;
    s = answerRound(s, wrong(s), 0);
    expect(s.points).toBe(before);
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(7);
  });

  it('ignores a second answer, non-Options and is immutable', () => {
    const s0 = make('classic');
    expect(answerRound(s0, 'zz', 0)).toBe(s0);
    const s1 = answerRound(s0, wrong(s0), 0);
    expect(answerRound(s1, right(s1), 0)).toBe(s1);
    expect(s0.pick).toBeNull();
    expect(nextQuestion(s0, 0)).toBe(s0); // not answered yet
  });
});

describe('Classic', () => {
  it('finishes on the 10th answer with 10-question totals and ignores later answers', () => {
    let s = make('classic', 3);
    const answers = new Set<string>();
    for (let i = 0; i < 10; i++) {
      expectValidQuestion(s);
      answers.add(s.question.answer);
      expect(s.questionNumber).toBe(i + 1);
      s = answerRound(s, i < 7 ? right(s) : wrong(s), i * 1000);
      if (i < 9) {
        expect(s.finished).toBe(false);
        s = nextQuestion(s, i * 1000);
      }
    }
    expect(answers.size).toBe(10);
    expect(s.finished).toBe(true);
    expect(s.endReason).toBe('questions');
    expect(nextQuestion(s, 99_000)).toBe(s);
    expect(answerRound(s, s.question.options[0] as string, 99_000)).toBe(s);
    const result = getRoundResult(s);
    expect(result).toMatchObject({ mode: 'classic', correct: 7, answered: 10, finished: true, bestStreak: 7 });
    expect(result.missed).toHaveLength(3);
    expect(result.points).toBe(s.points);
    // The Passport input: the answer country of each Question, in order.
    expect(result.answers).toEqual(s.history.map((a) => ({ code: a.answer, correct: a.correct })));
    expect(result.answers.map((a) => a.correct)).toEqual(result.results);
    expect(new Set(result.answers.map((a) => a.code))).toEqual(answers);
  });

  it('records the answers of a quit (unfinished) Round, Reverse included', () => {
    let s = createRound({ mode: 'classic', countries: COUNTRIES, setup: { direction: 'name' }, random: createSeededRandom(3), nowMs: 0 });
    const first = s.question.answer;
    s = nextQuestion(answerRound(s, right(s), 100), 200);
    const second = s.question.answer;
    s = answerRound(s, wrong(s), 300);
    const result = getRoundResult(s);
    expect(result.finished).toBe(false);
    expect(result.answers).toEqual([
      { code: first, correct: true },
      { code: second, correct: false },
    ]);
  });
});

describe('Time Attack', () => {
  it('finishes when tick reaches the deadline; the unanswered Question is not scored', () => {
    let s = make('timeAttack');
    s = nextQuestion(answerRound(s, right(s), 1000), 1700);
    const points = s.points;
    expect(tick(s, 59_999)).toBe(s);
    s = tick(s, 60_000);
    expect(s.finished).toBe(true);
    expect(s.endReason).toBe('time');
    expect(s.answered).toBe(1);
    expect(s.points).toBe(points);
    expect(remainingMs(s, 60_000)).toBe(0);
  });

  it('does not score an answer given after the deadline', () => {
    const s0 = make('timeAttack');
    const s = answerRound(s0, right(s0), 61_000);
    expect(s.finished).toBe(true);
    expect(s.answered).toBe(0);
    expect(s.points).toBe(0);
  });

  it('moves the deadline 3 s earlier on a wrong answer', () => {
    const s0 = make('timeAttack');
    const s = answerRound(s0, wrong(s0), 20_000);
    expect(s.deadlineMs).toBe(57_000);
    expect(remainingMs(s, 20_000)).toBe(37_000);
    expect(s.finished).toBe(false);
  });

  it('never moves the deadline below now, and finishes when the penalty uses up the time', () => {
    const s0 = make('timeAttack');
    const s = answerRound(s0, wrong(s0), 58_500);
    expect(s.deadlineMs).toBe(58_500);
    expect(s.finished).toBe(true);
    expect(s.endReason).toBe('time');
  });

  it('pauses and resumes: the deadline shifts by the paused time and paused answers are ignored', () => {
    let s = make('timeAttack');
    s = pause(s, 30_000);
    expect(pause(s, 35_000)).toBe(s); // double pause
    expect(remainingMs(s, 45_000)).toBe(30_000);
    expect(answerRound(s, right(s), 40_000)).toBe(s);
    expect(tick(s, 70_000)).toBe(s); // no expiry while paused
    s = resume(s, 50_000);
    expect(resume(s, 55_000)).toBe(s); // double resume
    expect(s.deadlineMs).toBe(80_000);
    expect(remainingMs(s, 50_000)).toBe(30_000);
    expect(s.shownAtMs).toBe(20_000); // Speed Bonus is not eaten by the pause
  });

  it('starts the next Question clock on resume when advanced while paused', () => {
    let s = make('timeAttack');
    s = answerRound(s, right(s), 1000);
    s = pause(s, 1200);
    s = nextQuestion(s, 1700);
    s = resume(s, 9000);
    expect(s.shownAtMs).toBe(9000);
  });
});

describe('Survival', () => {
  it('finishes on the 3rd wrong answer with 0 Lives', () => {
    let s = make('survival');
    s = nextQuestion(answerRound(s, wrong(s), 0), 0);
    expect(s.lives).toBe(2);
    s = nextQuestion(answerRound(s, right(s), 0), 0);
    s = nextQuestion(answerRound(s, wrong(s), 0), 0);
    expect(s.lives).toBe(1);
    expect(s.finished).toBe(false);
    s = answerRound(s, wrong(s), 0);
    expect(s.lives).toBe(0);
    expect(s.finished).toBe(true);
    expect(s.endReason).toBe('lives');
    expect(getRoundResult(s)).toMatchObject({ correct: 1, answered: 4 });
  });

  it('never repeats an answer within each pass of the 193-country pool', () => {
    let s = make('survival', 11);
    const seen: string[] = [];
    for (let i = 0; i < 200; i++) {
      expectValidQuestion(s);
      seen.push(s.question.answer);
      s = nextQuestion(answerRound(s, right(s), i), i);
    }
    const firstPass = seen.slice(0, 193);
    expect(new Set(firstPass).size).toBe(193);
    const secondPass = seen.slice(193);
    expect(new Set(secondPass).size).toBe(secondPass.length);
    expect(seen[193]).not.toBe(seen[192]); // no back-to-back repeat at the pass boundary
  });
});

describe('fairness', () => {
  it('puts the correct Option in every position about equally', () => {
    let s = make('survival', 5);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 2000; i++) {
      counts[s.question.options.indexOf(s.question.answer)]! += 1;
      s = nextQuestion(answerRound(s, right(s), 0), 0);
    }
    for (const c of counts) expect(c).toBeGreaterThan(400);
  });
});

describe('Round setup', () => {
  const withSetup = (mode: GameMode, setup: Partial<RoundSetup>, seed = 1) =>
    createRound({ mode, countries: COUNTRIES, setup, random: createSeededRandom(seed), nowMs: 0 });
  const wrongOptions = (q: Question) => q.options.filter((o) => o !== q.answer);

  it('defaults to All / Normal / Flag → Name and carries the setup into the result', () => {
    expect(make('classic').setup).toEqual(DEFAULT_SETUP);
    const s = withSetup('survival', { region: 'asia', difficulty: 'hard', direction: 'name' });
    expect(s.setup).toEqual({ quiz: 'flags', region: 'asia', difficulty: 'hard', direction: 'name' });
    expect(getRoundResult(s).setup).toEqual({ quiz: 'flags', region: 'asia', difficulty: 'hard', direction: 'name' });
  });

  it('falls back to defaults for unknown setup values', () => {
    const s = withSetup('classic', { region: 'mars' as never, difficulty: 'insane' as never });
    expect(s.setup).toEqual(DEFAULT_SETUP);
    expect(s.pool).toHaveLength(193);
  });

  it('Classic Europe: 10 European answers and every Option European', () => {
    let s = withSetup('classic', { region: 'europe' }, 3);
    const answers: string[] = [];
    while (!s.finished) {
      expectValidQuestion(s);
      for (const o of s.question.options) expect(continentOf(o), o).toBe('europe');
      answers.push(s.question.answer);
      s = answerRound(s, right(s), 0);
      s = nextQuestion(s, 0);
    }
    expect(answers).toHaveLength(10);
    expect(new Set(answers).size).toBe(10);
  });

  it('Survival Oceania runs through all 14 countries before any repeat', () => {
    let s = withSetup('survival', { region: 'oceania' }, 9);
    const seen: string[] = [];
    for (let i = 0; i < 28; i++) {
      expectValidQuestion(s);
      seen.push(s.question.answer);
      s = nextQuestion(answerRound(s, right(s), i), i);
    }
    expect(new Set(seen.slice(0, 14))).toEqual(new Set(poolFor('oceania')));
    expect(new Set(seen.slice(14)).size).toBe(14);
    expect(seen[14]).not.toBe(seen[13]);
  });

  it('Hard: an answer in a Look-alike Group gets at least 2 wrong Options from that group', () => {
    for (let seed = 0; seed < 50; seed++) {
      const q = buildQuestion('td', poolFor('all'), createSeededRandom(seed), 'hard');
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(wrongOptions(q).filter((o) => ['ro', 'ad', 'md'].includes(o)).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('Hard + Region: group members outside the Region are skipped; distractors come from the Region', () => {
    for (let seed = 0; seed < 50; seed++) {
      const q = buildQuestion('td', poolFor('africa'), createSeededRandom(seed), 'hard');
      expect(new Set(q.options).size).toBe(4);
      for (const o of q.options) expect(continentOf(o)).toBe('africa');
    }
    // Ireland's group: Côte d'Ivoire (Africa) is cut from a Europe pool, Italy stays.
    const q = buildQuestion('ie', poolFor('europe'), createSeededRandom(1), 'hard');
    expect(q.options).toContain('it');
    expect(q.options).not.toContain('ci');
  });

  it('Hard, no group: wrong Options from the same continent, then the rest of the pool', () => {
    for (let seed = 0; seed < 20; seed++) {
      const q = buildQuestion('fr', poolFor('all'), createSeededRandom(seed), 'hard');
      for (const o of q.options) expect(continentOf(o)).toBe('europe');
    }
    // Only one other European country in the pool: the rest come from anywhere.
    const q = buildQuestion('fr', ['fr', 'es', 'jp', 'br', 'ca'], createSeededRandom(2), 'hard');
    expect(q.options).toContain('es');
    expect(new Set(q.options).size).toBe(4);
  });

  it('Hard Rounds keep valid Questions with the answer in every position about equally', () => {
    let s = withSetup('survival', { difficulty: 'hard' }, 5);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 2000; i++) {
      expectValidQuestion(s);
      const group = groupOf(s.question.answer);
      if (group) {
        const inGroup = wrongOptions(s.question).filter((o) => group.includes(o)).length;
        expect(inGroup).toBeGreaterThanOrEqual(Math.min(2, group.length - 1));
      }
      counts[s.question.options.indexOf(s.question.answer)]! += 1;
      s = nextQuestion(answerRound(s, right(s), 0), 0);
    }
    for (const c of counts) expect(c).toBeGreaterThan(400);
  });

  it('Reverse: the Direction is carried in state; the answer is the correct (flag) Option', () => {
    let s = withSetup('classic', { direction: 'name' });
    expect(s.setup.direction).toBe('name');
    expectValidQuestion(s);
    s = answerRound(s, s.question.answer, 1000);
    expect(s.history[0]?.correct).toBe(true);
  });

  it('Daily ignores any requested setup', () => {
    const s = createRound({
      mode: 'daily',
      countries: COUNTRIES,
      setup: { region: 'europe', difficulty: 'hard', direction: 'name' },
      random: createSeededRandom(1),
      nowMs: 0,
    });
    expect(s.setup).toEqual(DEFAULT_SETUP);
    expect(s.pool).toHaveLength(193);
  });
});

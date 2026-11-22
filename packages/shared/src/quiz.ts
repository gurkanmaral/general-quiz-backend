import { groupOf } from './lookalikes';
import { shuffle, type RandomFn } from './random';
import { continentOf } from './regions';
import type { Difficulty, Quiz } from './setup';

/** Number of answer options shown per question. */
export const OPTIONS_PER_QUESTION = 4;
/** Default number of questions per round. */
export const DEFAULT_QUESTION_COUNT = 10;

export type Question = {
  /** ISO code of the correct country. */
  answer: string;
  /** ISO codes of the options (unique, includes `answer`). */
  options: string[];
};

export type QuizState = {
  questions: Question[];
  /** Index of the current question. */
  index: number;
  /** Picked code per question, or null when unanswered. */
  picks: (string | null)[];
  score: number;
  /** True once the last question has been answered. */
  finished: boolean;
};

export type QuizResult = {
  score: number;
  total: number;
  /** ISO codes of the countries that were answered wrong (or not answered). */
  missed: string[];
};

export type CreateQuizOptions = {
  /** Pool of countries; only `code` is used. */
  countries: readonly { code: string }[];
  /** Questions per round; clamped to [1, pool size]. Defaults to 10. */
  count?: number;
  /** Random source in [0, 1). Defaults to Math.random. */
  random?: RandomFn;
};

/**
 * Build one Question: the answer plus 3 unique distractors from `pool`,
 * with the correct Option at a uniformly random position. The Quiz only matters
 * on Hard: Look-alike Groups apply to Flags alone.
 */
export function buildQuestion(
  answer: string,
  pool: readonly string[],
  random: RandomFn,
  difficulty: Difficulty = 'normal',
  quiz: Quiz = 'flags',
): Question {
  if (difficulty === 'hard') return buildHardQuestion(answer, pool, random, quiz === 'flags');
  // Normal: unchanged on purpose — the Daily Challenge depends on this exact random sequence.
  const distractors = shuffle(
    pool.filter((code) => code !== answer),
    random,
  ).slice(0, OPTIONS_PER_QUESTION - 1);
  return { answer, options: shuffle([answer, ...distractors], random) };
}

/**
 * Hard: wrong Options come first from the answer's Look-alike Group (Flags only; members inside
 * `pool` only, up to all 3 — so at least 2 whenever 2 exist), then from the answer's own continent,
 * then from anywhere in `pool`. Capitals and Shapes skip the Look-alike step (continent first).
 */
function buildHardQuestion(answer: string, pool: readonly string[], random: RandomFn, lookalikes: boolean): Question {
  const wanted = OPTIONS_PER_QUESTION - 1;
  const others = pool.filter((code) => code !== answer);
  const group = new Set(lookalikes ? (groupOf(answer) ?? []) : []);
  const continent = continentOf(answer);
  const alike = shuffle(others.filter((code) => group.has(code)), random);
  const sameContinent = shuffle(
    others.filter((code) => !group.has(code) && continent !== undefined && continentOf(code) === continent),
    random,
  );
  const rest = shuffle(
    others.filter((code) => !group.has(code) && (continent === undefined || continentOf(code) !== continent)),
    random,
  );
  const distractors = [...alike, ...sameContinent, ...rest].slice(0, wanted);
  return { answer, options: shuffle([answer, ...distractors], random) };
}

export function createQuiz({
  countries,
  count = DEFAULT_QUESTION_COUNT,
  random = Math.random,
}: CreateQuizOptions): QuizState {
  const pool = Array.from(new Set(countries.map((c) => c.code)));
  if (pool.length < OPTIONS_PER_QUESTION) {
    throw new Error(
      `createQuiz needs at least ${OPTIONS_PER_QUESTION} unique countries (got ${pool.length}).`,
    );
  }

  const requested = Number.isFinite(count) ? Math.floor(count) : DEFAULT_QUESTION_COUNT;
  const total = Math.min(Math.max(requested, 1), pool.length);
  const answers = shuffle(pool, random).slice(0, total);

  const questions: Question[] = answers.map((answer) => buildQuestion(answer, pool, random));

  return {
    questions,
    index: 0,
    picks: questions.map(() => null),
    score: 0,
    finished: false,
  };
}

export function currentQuestion(state: QuizState): Question {
  return state.questions[state.index] as Question;
}

/** The pick for the current question, or null if not answered yet. */
export function currentPick(state: QuizState): string | null {
  return state.picks[state.index] ?? null;
}

/**
 * Answer the current question. Returns the same state (no-op) when the
 * question was already answered, the quiz is finished, or `code` is not an option.
 */
export function answer(state: QuizState, code: string): QuizState {
  const question = currentQuestion(state);
  if (state.finished || currentPick(state) !== null || !question.options.includes(code)) {
    return state;
  }
  const picks = state.picks.slice();
  picks[state.index] = code;
  const isLast = state.index === state.questions.length - 1;
  return {
    ...state,
    picks,
    score: state.score + (code === question.answer ? 1 : 0),
    finished: isLast,
  };
}

/** Move to the next question. No-op until the current question is answered, or on the last one. */
export function next(state: QuizState): QuizState {
  if (currentPick(state) === null || state.index >= state.questions.length - 1) {
    return state;
  }
  return { ...state, index: state.index + 1 };
}

export function getResult(state: QuizState): QuizResult {
  const missed = state.questions
    .filter((q, i) => state.picks[i] !== q.answer)
    .map((q) => q.answer);
  return { score: state.score, total: state.questions.length, missed };
}

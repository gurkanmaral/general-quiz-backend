import { buildQuestion, OPTIONS_PER_QUESTION, type Question } from './quiz';
import { createSeededRandom, shuffle, type RandomFn } from './random';
import { continentOf } from './regions';
import { pointsFor } from './scoring';
import { DEFAULT_SETUP, normalizeSetup, type RoundSetup } from './setup';

/**
 * Round engine for the Game Modes. Every function is pure: state is never
 * mutated and time is always passed in as `nowMs` (any monotonic clock in ms).
 */

export const GAME_MODES = ['classic', 'timeAttack', 'survival', 'daily'] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** The Game Modes offered on the Mode select screen (the Daily Challenge starts from Home). */
export const PLAY_MODES = ['classic', 'timeAttack', 'survival'] as const;
export type PlayMode = (typeof PLAY_MODES)[number];

/** Questions in a Classic Round. */
export const CLASSIC_QUESTION_COUNT = 10;
/** Length of a Time Attack Round. */
export const TIME_ATTACK_DURATION_MS = 60_000;
/** Time removed by a wrong answer in Time Attack. */
export const TIME_ATTACK_PENALTY_MS = 3_000;
/** Lives at the start of a Survival Round. */
export const SURVIVAL_LIVES = 3;

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === 'string' && (GAME_MODES as readonly string[]).includes(value);
}

export function isPlayMode(value: unknown): value is PlayMode {
  return typeof value === 'string' && (PLAY_MODES as readonly string[]).includes(value);
}

/** Classic and the Daily Challenge: a fixed Round of `CLASSIC_QUESTION_COUNT` Questions. */
export function isFixedLength(mode: GameMode): boolean {
  return mode === 'classic' || mode === 'daily';
}

export type RoundAnswer = {
  /** The correct country. */
  answer: string;
  /** The Option the player picked. */
  pick: string;
  correct: boolean;
  /** Points this answer earned. */
  points: number;
  /** Streak after this answer. */
  streak: number;
};

/** One answered Question for the Flag Passport: the answer country and whether it was answered correctly. */
export type AnsweredCountry = {
  code: string;
  correct: boolean;
};

export type RoundEndReason = 'questions' | 'time' | 'lives';

export type RoundState = {
  readonly mode: GameMode;
  /** Quiz, Region, Difficulty and Direction of this Round. */
  readonly setup: Readonly<RoundSetup>;
  /** Unique country codes the Round draws from. */
  readonly pool: readonly string[];
  /** Answer order of the current pass through the pool (Classic: the whole Round). */
  readonly order: readonly string[];
  /** Index of the current Question's answer in `order`. */
  readonly orderIndex: number;
  /** PRNG state for the next Question / reshuffle. */
  readonly seed: number;
  readonly question: Question;
  /** 1-based number of the current Question in this Round. */
  readonly questionNumber: number;
  /** When the current Question was shown. */
  readonly shownAtMs: number;
  /** Picked Option for the current Question, or null. */
  readonly pick: string | null;
  readonly points: number;
  readonly streak: number;
  readonly bestStreak: number;
  readonly correct: number;
  readonly answered: number;
  /** Survival only; null in other modes. */
  readonly lives: number | null;
  /** Time Attack only; null in other modes. */
  readonly deadlineMs: number | null;
  /** Set while paused. */
  readonly pausedAtMs: number | null;
  readonly finished: boolean;
  readonly endReason: RoundEndReason | null;
  /** Every answer given, in order. */
  readonly history: readonly RoundAnswer[];
};

export type RoundResult = {
  mode: GameMode;
  setup: RoundSetup;
  points: number;
  correct: number;
  answered: number;
  bestStreak: number;
  /** Countries answered wrong (unique, in order of first miss). */
  missed: string[];
  /** Correctness of each answer, in order. */
  results: boolean[];
  /** The answer country of each answered Question, in order (Flag Passport input). */
  answers: AnsweredCountry[];
  /** False when the Round was not played to its end (e.g. quit). */
  finished: boolean;
  endReason: RoundEndReason | null;
};

export type CreateRoundOptions = {
  mode: GameMode;
  /** Pool of countries; only `code` is used. Narrowed to `setup.region`. */
  countries: readonly { code: string }[];
  /** Quiz, Region, Difficulty and Direction (missing fields: defaults). Ignored for the Daily Challenge, which is fixed (Flags). */
  setup?: Partial<RoundSetup>;
  /** Random source in [0, 1). Defaults to Math.random. */
  random?: RandomFn;
  nowMs: number;
};

const UINT32 = 4294967296;

/** Run `fn` with a seeded random, returning its result and the next seed. */
function withSeed<T>(seed: number, fn: (random: RandomFn) => T): [T, number] {
  const random = createSeededRandom(seed);
  const value = fn(random);
  return [value, Math.floor(random() * UINT32)];
}

/** A fresh pass order; avoids starting with `previous` so the answer never repeats back-to-back. */
function newPass(pool: readonly string[], random: RandomFn, previous?: string): string[] {
  const order = shuffle(pool, random);
  if (previous !== undefined && order.length > 1 && order[0] === previous) {
    const last = order.length - 1;
    order[0] = order[last] as string;
    order[last] = previous;
  }
  return order;
}

export function createRound({ mode, countries, setup: requested, random = Math.random, nowMs }: CreateRoundOptions): RoundState {
  const setup: RoundSetup = mode === 'daily' ? { ...DEFAULT_SETUP } : normalizeSetup(requested);
  const unique = Array.from(new Set(countries.map((c) => c.code)));
  const pool = setup.region === 'all' ? unique : unique.filter((code) => continentOf(code) === setup.region);
  if (pool.length < OPTIONS_PER_QUESTION) {
    throw new Error(`createRound needs at least ${OPTIONS_PER_QUESTION} unique countries (got ${pool.length}).`);
  }
  const startSeed = Math.floor(random() * UINT32);
  const [[order, question], seed] = withSeed(startSeed, (r) => {
    const pass = newPass(pool, r);
    const o = isFixedLength(mode) ? pass.slice(0, CLASSIC_QUESTION_COUNT) : pass;
    return [o, buildQuestion(o[0] as string, pool, r, setup.difficulty, setup.quiz)] as const;
  });

  return {
    mode,
    setup,
    pool,
    order,
    orderIndex: 0,
    seed,
    question,
    questionNumber: 1,
    shownAtMs: nowMs,
    pick: null,
    points: 0,
    streak: 0,
    bestStreak: 0,
    correct: 0,
    answered: 0,
    lives: mode === 'survival' ? SURVIVAL_LIVES : null,
    deadlineMs: mode === 'timeAttack' ? nowMs + TIME_ATTACK_DURATION_MS : null,
    pausedAtMs: null,
    finished: false,
    endReason: null,
    history: [],
  };
}

/** Number of Questions in the Round, or null for the endless modes. */
export function roundLength(state: RoundState): number | null {
  return isFixedLength(state.mode) ? state.order.length : null;
}

/** Time left in a Time Attack Round (frozen while paused), or null in other modes. */
export function remainingMs(state: RoundState, nowMs: number): number | null {
  if (state.deadlineMs === null) return null;
  if (state.finished && state.endReason === 'time') return 0;
  const at = state.pausedAtMs ?? nowMs;
  return Math.max(0, state.deadlineMs - at);
}

/** Answer the current Question. Ignored when finished, paused, already answered or `code` is not an Option. */
export function answerRound(state: RoundState, code: string, nowMs: number): RoundState {
  if (state.finished || state.pausedAtMs !== null || state.pick !== null) return state;
  if (!state.question.options.includes(code)) return state;
  // Time ran out before the answer: the current Question is not scored.
  if (state.deadlineMs !== null && nowMs >= state.deadlineMs) return tick(state, nowMs);

  const correct = code === state.question.answer;
  const streak = correct ? state.streak + 1 : 0;
  const points = pointsFor({ correct, elapsedMs: nowMs - state.shownAtMs, streak });
  const answered = state.answered + 1;
  const lives = state.lives !== null && !correct ? Math.max(0, state.lives - 1) : state.lives;
  const deadlineMs =
    state.deadlineMs !== null && !correct
      ? Math.max(nowMs, state.deadlineMs - TIME_ATTACK_PENALTY_MS)
      : state.deadlineMs;

  let endReason: RoundEndReason | null = null;
  if (isFixedLength(state.mode) && answered >= state.order.length) endReason = 'questions';
  else if (lives !== null && lives <= 0) endReason = 'lives';
  else if (deadlineMs !== null && nowMs >= deadlineMs) endReason = 'time';

  return {
    ...state,
    pick: code,
    points: state.points + points,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    correct: state.correct + (correct ? 1 : 0),
    answered,
    lives,
    deadlineMs,
    finished: endReason !== null,
    endReason,
    history: [...state.history, { answer: state.question.answer, pick: code, correct, points, streak }],
  };
}

/**
 * Show the next Question. Only after the current one is answered and while the
 * Round is not finished. In the endless modes the pool reshuffles once used up.
 */
export function nextQuestion(state: RoundState, nowMs: number): RoundState {
  if (state.finished || state.pick === null) return state;
  const expired = tick(state, nowMs);
  if (expired.finished) return expired;

  let order = state.order;
  let orderIndex = state.orderIndex + 1;
  const [question, seed] = withSeed(state.seed, (r) => {
    if (orderIndex >= order.length) {
      if (isFixedLength(state.mode)) return null;
      order = newPass(state.pool, r, state.question.answer);
      orderIndex = 0;
    }
    return buildQuestion(order[orderIndex] as string, state.pool, r, state.setup.difficulty, state.setup.quiz);
  });
  if (question === null) return state;

  return {
    ...state,
    order,
    orderIndex,
    seed,
    question,
    questionNumber: state.questionNumber + 1,
    // While paused, the clock starts when play resumes (resume shifts it).
    shownAtMs: state.pausedAtMs ?? nowMs,
    pick: null,
  };
}

/** Finish a Time Attack Round once `nowMs` reaches the deadline. No-op otherwise or while paused. */
export function tick(state: RoundState, nowMs: number): RoundState {
  if (state.finished || state.deadlineMs === null || state.pausedAtMs !== null) return state;
  if (nowMs < state.deadlineMs) return state;
  return { ...state, finished: true, endReason: 'time' };
}

/** Pause the Round clock (e.g. the tab was hidden). Double pause is a no-op. */
export function pause(state: RoundState, nowMs: number): RoundState {
  if (state.finished || state.pausedAtMs !== null) return state;
  return { ...state, pausedAtMs: nowMs };
}

/** Resume the Round clock: the deadline and the current Question's shown time move by the paused duration. */
export function resume(state: RoundState, nowMs: number): RoundState {
  if (state.pausedAtMs === null) return state;
  const delta = Math.max(0, nowMs - state.pausedAtMs);
  return {
    ...state,
    pausedAtMs: null,
    deadlineMs: state.deadlineMs === null ? null : state.deadlineMs + delta,
    shownAtMs: state.pick === null ? state.shownAtMs + delta : state.shownAtMs,
  };
}

export function getRoundResult(state: RoundState): RoundResult {
  const missed = Array.from(new Set(state.history.filter((a) => !a.correct).map((a) => a.answer)));
  return {
    mode: state.mode,
    setup: { ...state.setup },
    points: state.points,
    correct: state.correct,
    answered: state.answered,
    bestStreak: state.bestStreak,
    missed,
    results: state.history.map((a) => a.correct),
    answers: state.history.map((a) => ({ code: a.answer, correct: a.correct })),
    finished: state.finished,
    endReason: state.endReason,
  };
}

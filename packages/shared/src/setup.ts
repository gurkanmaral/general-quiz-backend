import { isRegion, type Region } from './regions';

/** Round setup (FR-8): which countries appear, how hard the Options are, and what the prompt shows. */

export const DIFFICULTIES = ['normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** `flag`: Flag → Name (default). `name`: Name → Flag (Reverse). */
export const DIRECTIONS = ['flag', 'name'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** What a Question asks about: `flags` (default), `capitals` or `shapes` (country outlines). */
export const QUIZZES = ['flags', 'capitals', 'shapes'] as const;
export type Quiz = (typeof QUIZZES)[number];

export type RoundSetup = {
  quiz: Quiz;
  region: Region;
  difficulty: Difficulty;
  direction: Direction;
};

/** Flags, All Regions, Normal, Flag → Name. Also the Daily Challenge's fixed setup. */
export const DEFAULT_SETUP: Readonly<RoundSetup> = Object.freeze({
  quiz: 'flags',
  region: 'all',
  difficulty: 'normal',
  direction: 'flag',
});

export function isQuiz(value: unknown): value is Quiz {
  return typeof value === 'string' && (QUIZZES as readonly string[]).includes(value);
}

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value);
}

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value);
}

/** A valid setup from untrusted input: each missing or unknown field falls back to its default. */
export function normalizeSetup(value: unknown): RoundSetup {
  const raw = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    quiz: isQuiz(raw.quiz) ? raw.quiz : DEFAULT_SETUP.quiz,
    region: isRegion(raw.region) ? raw.region : DEFAULT_SETUP.region,
    difficulty: isDifficulty(raw.difficulty) ? raw.difficulty : DEFAULT_SETUP.difficulty,
    direction: isDirection(raw.direction) ? raw.direction : DEFAULT_SETUP.direction,
  };
}

export function isDefaultSetup(setup: RoundSetup): boolean {
  return (
    setup.quiz === DEFAULT_SETUP.quiz &&
    setup.region === DEFAULT_SETUP.region &&
    setup.difficulty === DEFAULT_SETUP.difficulty &&
    setup.direction === DEFAULT_SETUP.direction
  );
}

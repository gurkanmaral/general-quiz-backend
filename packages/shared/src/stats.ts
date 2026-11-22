import type { Progress } from './progress';
import { CONTINENTS, continentOf, type Continent } from './regions';

/**
 * Stats: totals over the Round history, per-continent accuracy and most-missed
 * countries from the Flag Passport, and the Points of the most recent Rounds.
 */

export const MOST_MISSED_COUNT = 5;
export const RECENT_ROUNDS = 20;

export type ContinentStats = {
  continent: Continent;
  answered: number;
  correct: number;
  /** 0–1, or null when nothing was answered. */
  accuracy: number | null;
};

export type MissedCountry = { code: string; missed: number; seen: number };

export type Stats = {
  /** Finished Rounds in the history (the last `HISTORY_LIMIT`). */
  rounds: number;
  /** Answers given in those Rounds. */
  answers: number;
  correct: number;
  /** 0–1, or null when nothing was answered. */
  accuracy: number | null;
  continents: ContinentStats[];
  /** Up to `MOST_MISSED_COUNT` countries with misses, most missed first. */
  mostMissed: MissedCountry[];
  /** Points of the last `RECENT_ROUNDS` Rounds, oldest first. */
  recentPoints: number[];
  /** No Rounds and no answers yet. */
  empty: boolean;
};

const ratio = (correct: number, answered: number) => (answered > 0 ? correct / answered : null);

export function computeStats(progress: Pick<Progress, 'history' | 'passport'>): Stats {
  let answers = 0;
  let correct = 0;
  for (const r of progress.history) {
    answers += r.answered;
    correct += r.correct;
  }
  const byContinent = new Map<Continent, { answered: number; correct: number }>(
    CONTINENTS.map((c) => [c, { answered: 0, correct: 0 }]),
  );
  const missed: MissedCountry[] = [];
  for (const [code, entry] of Object.entries(progress.passport)) {
    const continent = continentOf(code);
    const bucket = continent ? byContinent.get(continent) : undefined;
    if (bucket) {
      bucket.answered += entry.seen;
      bucket.correct += entry.correct;
    }
    const m = entry.seen - entry.correct;
    if (m > 0) missed.push({ code, missed: m, seen: entry.seen });
  }
  missed.sort((a, b) => b.missed - a.missed || a.seen - b.seen || a.code.localeCompare(b.code));
  const continents = CONTINENTS.map((continent) => {
    const b = byContinent.get(continent) as { answered: number; correct: number };
    return { continent, answered: b.answered, correct: b.correct, accuracy: ratio(b.correct, b.answered) };
  });
  const passportAnswers = continents.reduce((n, c) => n + c.answered, 0);
  return {
    rounds: progress.history.length,
    answers,
    correct,
    accuracy: ratio(correct, answers),
    continents,
    mostMissed: missed.slice(0, MOST_MISSED_COUNT),
    recentPoints: progress.history.slice(-RECENT_ROUNDS).map((r) => r.points),
    empty: progress.history.length === 0 && passportAnswers === 0,
  };
}

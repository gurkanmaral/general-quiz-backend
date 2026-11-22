import { describe, expect, it } from 'vitest';
import { COUNTRIES } from './countries';
import { createDailyRound } from './daily';
import { COUNTRY_FACTS, capitalOf, populationOf } from './facts';
import {
  answerHigherLower,
  createHigherLower,
  getHigherLowerResult,
  higherSide,
  isClearPair,
  type HigherLowerState,
} from './higherLower';
import shapes from './data/shapes.json';
import { loadShapes, type CountryShapes } from './shapes';
import { buildQuestion } from './quiz';
import { createSeededRandom } from './random';
import { continentOf, poolFor } from './regions';
import { createRound, getRoundResult, answerRound, type RoundState } from './round';
import { DEFAULT_SETUP, isDefaultSetup, normalizeSetup } from './setup';
import {
  HIGHER_LOWER_BEST_KEY,
  bestKey,
  emptyProgress,
  getBest,
  getHigherLowerBest,
  loadProgress,
  PROGRESS_KEY,
  recordBest,
  recordHigherLower,
  type KeyValueStore,
} from './progress';

const SHAPES = shapes as CountryShapes;
const codes = COUNTRIES.map((c) => c.code);

describe('country data coverage', () => {
  it('every country has a capital (en, tr), a population > 0 and a non-empty outline', () => {
    const gaps: string[] = [];
    for (const code of codes) {
      const facts = COUNTRY_FACTS[code];
      if (!facts?.capital.en || !facts.capital.tr) gaps.push(`${code}: capital`);
      if (!(facts && facts.population > 0)) gaps.push(`${code}: population`);
      const shape = SHAPES[code];
      if (!shape || !/^M/.test(shape.d) || !(shape.w > 0) || !(shape.h > 0)) gaps.push(`${code}: outline`);
    }
    expect(gaps).toEqual([]);
    expect(Object.keys(COUNTRY_FACTS).sort()).toEqual([...codes].sort());
    expect(Object.keys(SHAPES).sort()).toEqual([...codes].sort());
  });

  it('main capitals are unique per locale, so 4 Options always read as 4 different capitals', () => {
    for (const locale of ['en', 'tr'] as const) {
      const names = codes.map((c) => capitalOf(c, locale));
      expect(new Set(names).size).toBe(codes.length);
    }
  });

  it('outlines are fitted to a 100-unit box and the file stays under 400 kB', () => {
    for (const code of codes) {
      const { w, h } = SHAPES[code]!;
      expect(Math.max(w, h)).toBeCloseTo(100, 0);
      expect(Math.min(w, h)).toBeGreaterThan(0);
    }
    expect(JSON.stringify(shapes).length).toBeLessThanOrEqual(400 * 1024);
  });

  it('antimeridian countries are not smeared across the box', () => {
    // A smear would make the box extremely wide and flat; these fit in sensible proportions.
    for (const code of ['ru', 'fj', 'ki']) {
      const { w, h } = SHAPES[code]!;
      expect(w / h).toBeLessThan(2.5);
      expect(h / w).toBeLessThan(2.5);
    }
    expect(SHAPES.cl!.h / SHAPES.cl!.w).toBeGreaterThan(2.5); // Chile stays long and thin
  });

  it('loadShapes resolves the same data', async () => {
    const loaded = await loadShapes();
    expect(loaded.it).toEqual(SHAPES.it);
  });

  it('capitalOf / populationOf: locale-aware names, unknown codes are undefined', () => {
    expect(capitalOf('tr', 'en')).toBe('Ankara');
    expect(capitalOf('DE', 'tr')).toBe('Berlin');
    expect(capitalOf('za', 'tr')).toBe('Pretoria');
    expect(capitalOf('xx', 'en')).toBeUndefined();
    expect(capitalOf('fr', 'de')).toBe(capitalOf('fr', 'en'));
    expect(populationOf('cn')).toBeGreaterThan(1e9);
    expect(populationOf('xx')).toBeUndefined();
  });

  it('populations rank the biggest countries correctly (stale Wikidata values overridden)', () => {
    const p = (c: string) => populationOf(c) as number;
    expect(p('in')).toBeGreaterThan(p('cn'));
    expect(p('cn')).toBeGreaterThan(p('us'));
    expect(p('us')).toBeGreaterThan(p('id'));
    expect(p('id')).toBeGreaterThan(p('pk'));
    expect(p('pk')).toBeGreaterThan(p('ng'));
    expect(higherSide('cn', 'in')).toBe('right');
  });

  it('multi-capital countries use one designated main capital; the others are only "also"', () => {
    expect(capitalOf('bo', 'en')).toBe('Sucre');
    expect(COUNTRY_FACTS.bo!.also?.map((c) => c.en)).toContain('La Paz');
    expect(capitalOf('za', 'en')).toBe('Pretoria');
    // Turkish uses Wikidata's Turkish labels where they exist ("Kap Şehri" stays an "also").
    expect(COUNTRY_FACTS.za!.also?.map((c) => c.tr)).toContain('Kap Şehri');
    const mains = new Set(codes.map((c) => capitalOf(c, 'en')));
    for (const code of codes) for (const also of COUNTRY_FACTS[code]!.also ?? []) expect(mains.has(also.en)).toBe(false);
  });
});

describe('setup.quiz', () => {
  it('defaults to flags; unknown or corrupt values fall back to flags', () => {
    expect(DEFAULT_SETUP.quiz).toBe('flags');
    expect(normalizeSetup({ quiz: 'capitals' }).quiz).toBe('capitals');
    expect(normalizeSetup({ quiz: 'shapes', region: 'asia' })).toEqual({ ...DEFAULT_SETUP, quiz: 'shapes', region: 'asia' });
    expect(normalizeSetup({ quiz: 'planets' }).quiz).toBe('flags');
    expect(normalizeSetup(null).quiz).toBe('flags');
    expect(isDefaultSetup({ ...DEFAULT_SETUP, quiz: 'capitals' })).toBe(false);
  });
});

const round = (quiz: 'capitals' | 'shapes', over: Record<string, unknown> = {}, seed = 1) =>
  createRound({ mode: 'classic', countries: COUNTRIES, setup: { quiz, ...over }, random: createSeededRandom(seed), nowMs: 0 });

describe('Capitals and Shapes Rounds', () => {
  it('reuse the engine: answer country + 4 unique Option countries, setup carried into the result', () => {
    for (const quiz of ['capitals', 'shapes'] as const) {
      for (const direction of ['flag', 'name'] as const) {
        const s = round(quiz, { direction });
        expect(s.setup).toEqual({ ...DEFAULT_SETUP, quiz, direction });
        expect(new Set(s.question.options).size).toBe(4);
        expect(s.question.options).toContain(s.question.answer);
        expect(getRoundResult(s).setup.quiz).toBe(quiz);
      }
    }
  });

  it('Normal Options do not depend on the Quiz (same seed, same Questions as Flags)', () => {
    const flags = createRound({ mode: 'survival', countries: COUNTRIES, random: createSeededRandom(9), nowMs: 0 });
    const caps = createRound({ mode: 'survival', countries: COUNTRIES, setup: { quiz: 'capitals' }, random: createSeededRandom(9), nowMs: 0 });
    expect(caps.question).toEqual(flags.question);
  });

  it('Capitals Normal for tr: Ankara among 4 unique capitals', () => {
    for (let seed = 0; seed < 20; seed++) {
      const q = buildQuestion('tr', codes, createSeededRandom(seed), 'normal', 'capitals');
      const capitals = q.options.map((c) => capitalOf(c, 'en'));
      expect(capitals).toContain('Ankara');
      expect(new Set(capitals).size).toBe(4);
    }
  });

  it('Multi-capital: Bolivia shows Sucre, and La Paz never appears as an Option', () => {
    for (let seed = 0; seed < 50; seed++) {
      const q = buildQuestion('bo', codes, createSeededRandom(seed), 'hard', 'capitals');
      const capitals = q.options.map((c) => capitalOf(c, 'en'));
      expect(capitals).toContain('Sucre');
      expect(capitals).not.toContain('La Paz');
      expect(q.options.filter((c) => c === 'bo')).toHaveLength(1);
    }
  });

  it('Hard Capitals / Shapes: same-continent wrong Options first (all 3 for France), no Look-alike step', () => {
    for (const quiz of ['capitals', 'shapes'] as const) {
      for (let seed = 0; seed < 30; seed++) {
        const q = buildQuestion('fr', codes, createSeededRandom(seed), 'hard', quiz);
        const wrong = q.options.filter((c) => c !== 'fr');
        expect(wrong.filter((c) => continentOf(c) === 'europe').length).toBeGreaterThanOrEqual(2);
        expect(wrong.every((c) => continentOf(c) === 'europe')).toBe(true);
      }
    }
    // Flags Hard keeps its Look-alike Group: Chad's look-alike Romania (Europe) can appear; for Capitals it never does.
    let flagsRomania = 0;
    for (let seed = 0; seed < 40; seed++) {
      if (buildQuestion('td', codes, createSeededRandom(seed), 'hard', 'flags').options.includes('ro')) flagsRomania++;
      expect(buildQuestion('td', codes, createSeededRandom(seed), 'hard', 'capitals').options).not.toContain('ro');
    }
    expect(flagsRomania).toBeGreaterThan(0);
  });

  it('Hard on a small continent fills from the rest of the pool', () => {
    const tiny = ['fr', 'de', 'cn', 'jp', 'br'];
    const q = buildQuestion('fr', tiny, createSeededRandom(1), 'hard', 'capitals');
    expect(q.options.filter((c) => c !== 'fr').filter((c) => continentOf(c) !== 'europe')).toHaveLength(2);
    expect(new Set(q.options).size).toBe(4);
  });

  it('Region narrows the pool for every Quiz', () => {
    const s = round('shapes', { region: 'oceania' });
    expect(s.pool).toEqual(poolFor('oceania'));
  });
});

describe('Best keys with the Quiz', () => {
  const result = (setup: Record<string, unknown>) => ({
    mode: 'survival' as const,
    setup: normalizeSetup(setup),
    points: 300,
    correct: 3,
    answered: 6,
    bestStreak: 2,
    missed: [],
    results: [],
    answers: [],
    finished: true,
    endReason: 'lives' as const,
  });

  it('Survival / shapes / Asia → survival|asia|normal|flag|shapes; flag keys unchanged', () => {
    expect(bestKey('survival', 'asia', 'normal', 'flag', 'shapes')).toBe('survival|asia|normal|flag|shapes');
    expect(bestKey('classic', 'all', 'normal', 'name', 'capitals')).toBe('classic|all|normal|name|capitals');
    expect(bestKey('survival', 'asia', 'normal', 'flag', 'flags')).toBe('survival|asia|normal|flag');
    expect(bestKey('survival', 'asia')).toBe('survival|asia|normal|flag');

    let progress = recordBest(emptyProgress(), result({ region: 'asia' })).progress;
    progress = recordBest(progress, result({ region: 'asia', quiz: 'shapes' })).progress;
    expect(Object.keys(progress.bests).sort()).toEqual(['survival|asia|normal|flag', 'survival|asia|normal|flag|shapes']);
    expect(getBest(progress, 'survival', { region: 'asia', quiz: 'shapes' })?.correct).toBe(3);
    expect(getBest(progress, 'survival', { region: 'asia', quiz: 'capitals' })).toBeUndefined();
    // Unknown quiz → flags.
    expect(getBest(progress, 'survival', { region: 'asia', quiz: 'nope' as never })).toEqual(progress.bests['survival|asia|normal|flag']);
  });

  it('loads quiz-suffixed and Higher or Lower Bests; drops malformed suffixes', () => {
    const data = new Map<string, string>();
    const store: KeyValueStore = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
    const best = { points: 1, correct: 1, bestStreak: 1 };
    data.set(
      PROGRESS_KEY,
      JSON.stringify({
        v: 2,
        bests: {
          'classic|all|normal|flag': best,
          'classic|all|normal|flag|capitals': best,
          'classic|all|normal|flag|flags': best,
          'classic|all|normal|flag|planets': best,
          higherLower: { points: 7, correct: 7, bestStreak: 7 },
        },
      }),
    );
    expect(Object.keys(loadProgress(store).bests).sort()).toEqual([
      'classic|all|normal|flag',
      'classic|all|normal|flag|capitals',
      'higherLower',
    ]);
  });
});

describe('Higher or Lower', () => {
  const pairState = (left: string, right: string, over: Partial<HigherLowerState> = {}): HigherLowerState => ({
    ...createHigherLower({ random: createSeededRandom(1) }),
    left,
    right,
    seen: [left, right],
    ...over,
  });

  it('pick the bigger population: run +1, the winner stays as the left card and a new right card appears', () => {
    const s = pairState('cn', 'is');
    const next = answerHigherLower(s, 'left');
    expect(next.run).toBe(1);
    expect(next.finished).toBe(false);
    expect(next.left).toBe('cn');
    expect(next.right).not.toBe('cn');
    expect(next.right).not.toBe('is');
    expect(next.last).toEqual({ left: 'cn', right: 'is', pick: 'left', correct: true });
    // Winner on the right moves to the left.
    const flipped = answerHigherLower(pairState('is', 'cn'), 'right');
    expect(flipped.left).toBe('cn');
    expect(flipped.run).toBe(1);
  });

  it('a wrong pick ends the run; further picks are ignored', () => {
    const s = answerHigherLower(pairState('cn', 'is', { run: 4 }), 'right');
    expect(getHigherLowerResult(s)).toEqual({ run: 4, finished: true });
    expect(s.last?.correct).toBe(false);
    expect(answerHigherLower(s, 'left')).toBe(s);
  });

  it('never pairs near-equal populations (< 3 % apart)', () => {
    let s = createHigherLower({ random: createSeededRandom(5) });
    for (let i = 0; i < 400; i++) {
      expect(isClearPair(s.left, s.right)).toBe(true);
      s = answerHigherLower(s, higherSide(s.left, s.right));
    }
    expect(s.run).toBe(400);
    expect(isClearPair('cn', 'cn')).toBe(false);
  });

  it('is deterministic for a seeded random', () => {
    const play = (seed: number) => {
      let s = createHigherLower({ random: createSeededRandom(seed) });
      const pairs: string[] = [];
      for (let i = 0; i < 30; i++) {
        pairs.push(`${s.left}-${s.right}`);
        s = answerHigherLower(s, higherSide(s.left, s.right));
      }
      return pairs;
    };
    expect(play(42)).toEqual(play(42));
    expect(play(42)).not.toEqual(play(43));
  });

  it('records the longest run under higherLower', () => {
    let progress = emptyProgress();
    expect(getHigherLowerBest(progress)).toBeUndefined();
    let out = recordHigherLower(progress, 5);
    expect(out.isNewBest).toBe(true);
    progress = out.progress;
    expect(progress.bests[HIGHER_LOWER_BEST_KEY]).toEqual({ points: 5, correct: 5, bestStreak: 5 });
    out = recordHigherLower(progress, 3);
    expect(out.isNewBest).toBe(false);
    expect(out.progress).toBe(progress);
    expect(recordHigherLower(progress, 8).progress.bests.higherLower?.correct).toBe(8);
    const empty = emptyProgress();
    expect(recordHigherLower(empty, 0)).toEqual({ isNewBest: false, progress: empty });
  });
});

describe('Daily stays Flags', () => {
  it('ignores the Quiz: the Daily setup is the default Flags setup', () => {
    const s: RoundState = createDailyRound('2026-11-20', 0);
    expect(s.setup.quiz).toBe('flags');
    expect(answerRound(s, s.question.answer, 1000).setup).toEqual(DEFAULT_SETUP);
  });
});

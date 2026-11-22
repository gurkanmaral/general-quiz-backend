import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_DATA_VERSION,
  CHALLENGE_VERSION,
  maxClassicPoints,
  parseChallenge,
  challengeOutcome,
  createSeededClassicRound,
  decodeChallenge,
  encodeChallenge,
  newSeed,
  type Challenge,
} from './challenge';
import { againIndex, buildLearnDeck, learnAgain, learnGotIt, LEARN_DECK_SIZE } from './learn';
import {
  emptyProgress,
  HISTORY_LIMIT,
  loadProgress,
  PROGRESS_KEY,
  recordHistory,
  resetProgress,
  saveProgress,
  type KeyValueStore,
  type Progress,
} from './progress';
import { createSeededRandom } from './random';
import { answerRound, getRoundResult, nextQuestion, type RoundResult, type RoundState } from './round';
import { computeStats } from './stats';
import { levelOf, levelThreshold, recordXp, xpForResult } from './xp';
import { getCountry } from './countries';
import { DEFAULT_SETUP } from './setup';

// Node's globals (no @types/node here): used only to cross-check the hand-rolled base64url.
declare const btoa: (data: string) => string;
declare const atob: (data: string) => string;
const toB64Url = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (data: string) => atob(data.replace(/-/g, '+').replace(/_/g, '/'));

const GOLDEN = {
  order: ['tm', 'lv', 'to', 'np', 'ae', 'vu', 'ch', 'fj', 'se', 'kh'],
  first: ['bf', 'tm', 'az', 'cf'],
};

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const result = (over: Partial<RoundResult> = {}): RoundResult => ({
  mode: 'classic',
  setup: { quiz: 'flags', region: 'all', difficulty: 'normal', direction: 'flag' },
  points: 0,
  correct: 0,
  answered: 10,
  bestStreak: 0,
  missed: [],
  results: [],
  answers: [],
  finished: true,
  endReason: 'questions',
  ...over,
});

/** Play a whole Round (alternating right / wrong) and return every Question shown. */
function playThrough(start: RoundState) {
  let s = start;
  const questions = [s.question];
  let t = 0;
  while (!s.finished) {
    const pick = s.questionNumber % 2 === 0 ? s.question.answer : (s.question.options.find((o) => o !== s.question.answer) as string);
    s = answerRound(s, pick, (t += 1000));
    if (s.finished) break;
    s = nextQuestion(s, (t += 100));
    questions.push(s.question);
  }
  return { questions, state: s };
}

describe('Challenge', () => {
  const challenge: Challenge = {
    seed: 3_141_592_653,
    setup: { quiz: 'capitals', region: 'europe', difficulty: 'normal', direction: 'flag' },
    points: 1240,
    correct: 8,
  };

  it('round-trips: same setup and seed, and the replayed Round has the same Questions', () => {
    const payload = encodeChallenge(challenge);
    expect(payload.length).toBeLessThan(200);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = decodeChallenge(payload);
    expect(decoded).toEqual(challenge);
    const original = playThrough(createSeededClassicRound(challenge.seed, challenge.setup, 0));
    const replay = playThrough(createSeededClassicRound(decoded!.seed, decoded!.setup, 5_000));
    expect(original.questions).toHaveLength(10);
    expect(replay.questions).toEqual(original.questions);
    expect(getRoundResult(replay.state).setup).toEqual(challenge.setup);
  });

  it('holds the version and no personal data', () => {
    const json = JSON.parse(fromB64Url(encodeChallenge(challenge)));
    expect(json.v).toBe(CHALLENGE_VERSION);
    expect(json.g).toBe(CHALLENGE_DATA_VERSION);
    expect(Object.keys(json).sort()).toEqual(['c', 'd', 'g', 'o', 'p', 'q', 'r', 's', 'v']);
  });

  it('round-trips every seed edge', () => {
    for (const seed of [0, 1, 4294967295, newSeed(createSeededRandom(9))]) {
      expect(decodeChallenge(encodeChallenge({ ...challenge, seed }))?.seed).toBe(seed);
    }
  });

  it('rejects broken payloads and unknown versions', () => {
    const b64 = (o: unknown) => toB64Url(JSON.stringify(o));
    const good = { v: 1, g: CHALLENGE_DATA_VERSION, s: 5, q: 'flags', r: 'all', d: 'normal', o: 'flag', p: 100, c: 1 };
    expect(decodeChallenge(b64(good))).not.toBeNull();
    for (const bad of [
      'garbage',
      '',
      '!!!!',
      'a',
      b64('nope'),
      b64([1]),
      b64({ ...good, v: 2 }),
      b64({ ...good, v: '1' }),
      b64({ ...good, s: -1 }),
      b64({ ...good, s: 2 ** 32 }),
      b64({ ...good, s: 1.5 }),
      b64({ ...good, q: 'music' }),
      b64({ ...good, r: 'mars' }),
      b64({ ...good, d: 'easy' }),
      b64({ ...good, o: 'up' }),
      b64({ ...good, p: 99999 }),
      b64({ ...good, c: 11 }),
      b64({ ...good, c: undefined }),
      b64({ ...good, g: undefined }),
      // Points impossible for the correct count.
      b64({ ...good, c: 0, p: 1 }),
      b64({ ...good, c: 0, p: 4500 }),
      b64({ ...good, c: 1, p: 151 }),
    ]) {
      expect(decodeChallenge(bad)).toBeNull();
    }
  });

  it('accepts the best possible score for a correct count', () => {
    expect([0, 1, 2, 3, 6, 10].map(maxClassicPoints)).toEqual([0, 150, 300, 600, 1650, 3450]);
    const enc = (c: number, p: number) => encodeChallenge({ ...challenge, correct: c, points: p });
    expect(decodeChallenge(enc(0, 0))).not.toBeNull();
    expect(decodeChallenge(enc(10, 3450))).not.toBeNull();
    expect(decodeChallenge(enc(10, 3451))).toBeNull();
  });

  it('reports a link made for other country data as outdated', () => {
    const json = JSON.parse(fromB64Url(encodeChallenge(challenge)));
    expect(parseChallenge(toB64Url(JSON.stringify({ ...json, g: CHALLENGE_DATA_VERSION + 1 })))).toEqual({ ok: false, reason: 'outdated' });
    expect(parseChallenge('garbage')).toEqual({ ok: false, reason: 'broken' });
    expect(parseChallenge(encodeChallenge(challenge))).toEqual({ ok: true, challenge });
  });

  it('golden: a seed replays these Questions (bump CHALLENGE_DATA_VERSION when this changes)', () => {
    const round = createSeededClassicRound(1, DEFAULT_SETUP, 0);
    expect({ order: round.order, first: round.question.options }).toEqual(GOLDEN);
  });

  it('compares on Points (tie included)', () => {
    expect(challengeOutcome(980, 1240)).toBe('lose');
    expect(challengeOutcome(1300, 1240)).toBe('win');
    expect(challengeOutcome(1240, 1240)).toBe('tie');
  });
});

describe('Learn deck', () => {
  it('puts missed countries before unseen ones and leaves clean ones out', () => {
    const progress = { passport: { fr: { seen: 5, correct: 1 }, de: { seen: 2, correct: 2 } } };
    const deck = buildLearnDeck(progress, createSeededRandom(1));
    expect(deck).toHaveLength(LEARN_DECK_SIZE);
    expect(deck[0]).toBe('fr');
    expect(deck).not.toContain('de');
    expect(new Set(deck).size).toBe(deck.length);
  });

  it('orders misses by count and fills a short deck with clean countries last', () => {
    const passport: Progress['passport'] = { fr: { seen: 5, correct: 1 }, jp: { seen: 6, correct: 0 }, de: { seen: 2, correct: 2 } };
    // A deck larger than the unseen pool must reach the clean countries.
    const deck = buildLearnDeck({ passport }, createSeededRandom(2), 500);
    expect(deck.slice(0, 2)).toEqual(['jp', 'fr']);
    expect(deck[deck.length - 1]).toBe('de');
  });

  it('gives 10 random known countries with no data', () => {
    const a = buildLearnDeck({ passport: {} }, createSeededRandom(1));
    const b = buildLearnDeck({ passport: {} }, createSeededRandom(2));
    expect(a).toHaveLength(10);
    expect(a.every((c) => getCountry(c))).toBe(true);
    expect(a).not.toEqual(b);
  });

  it('Again puts the card 3 cards later, or last near the end; Got it removes it', () => {
    const deck = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    expect(learnAgain(deck)).toEqual(['b', 'c', 'd', 'a', 'e', 'f', 'g', 'h', 'i', 'j']);
    expect(learnAgain(['x', 'y'])).toEqual(['y', 'x']);
    expect(learnAgain(['x'])).toEqual(['x']);
    expect(learnAgain([])).toEqual([]);
    expect(againIndex(9)).toBe(3);
    expect(againIndex(1)).toBe(1);
    expect(learnGotIt(deck)).toEqual(deck.slice(1));
  });
});

describe('XP and Levels', () => {
  it('grants round(points / 10) for a finished Round and nothing for a quit one', () => {
    expect(xpForResult(result({ points: 1234 }))).toBe(123);
    expect(xpForResult(result({ points: 1235 }))).toBe(124);
    expect(xpForResult(result({ points: 1234, finished: false }))).toBe(0);
    expect(xpForResult(result({ points: 0 }))).toBe(0);
  });

  it('uses thresholds 100, 300, 600 …', () => {
    expect([1, 2, 3, 4].map(levelThreshold)).toEqual([100, 300, 600, 1000]);
    expect(levelOf(0)).toEqual({ level: 1, into: 0, needed: 100 });
    expect(levelOf(99).level).toBe(1);
    expect(levelOf(100)).toEqual({ level: 2, into: 0, needed: 200 });
    expect(levelOf(290)).toEqual({ level: 2, into: 190, needed: 200 });
    expect(levelOf(310)).toEqual({ level: 3, into: 10, needed: 300 });
    expect(levelOf(-5).level).toBe(1);
  });

  it('levels up from 290 to 310 XP', () => {
    const { progress, xp } = recordXp({ ...emptyProgress(), xp: 290 }, result({ points: 200 }));
    expect(progress.xp).toBe(310);
    expect(xp).toMatchObject({ gained: 20, levelUp: true });
    expect(xp.before.level).toBe(2);
    expect(xp.after.level).toBe(3);
    const quit = recordXp({ ...emptyProgress(), xp: 290 }, result({ points: 200, finished: false }));
    expect(quit.progress.xp).toBe(290);
    expect(quit.xp.levelUp).toBe(false);
  });
});

describe('History and persistence', () => {
  it('drops the oldest beyond 50 rounds and ignores quit Rounds', () => {
    let progress = emptyProgress();
    for (let i = 0; i < HISTORY_LIMIT + 1; i++) progress = recordHistory(progress, result({ points: i }), `2026-11-08T00:00:${i}Z`);
    expect(progress.history).toHaveLength(HISTORY_LIMIT);
    expect(progress.history[0]?.points).toBe(1);
    // The lifetime counter keeps going past the capped history.
    expect(progress.roundsPlayed).toBe(HISTORY_LIMIT + 1);
    expect(recordHistory(progress, result({ finished: false }), 'x')).toBe(progress);
  });

  it('round-trips xp and history; old data and corrupt parts load empty; reset clears them', () => {
    const store = memoryStore();
    const saved = recordHistory({ ...emptyProgress(), xp: 42 }, result({ points: 420, correct: 7 }), '2026-11-08T10:00:00.000Z');
    saveProgress(store, saved);
    expect(loadProgress(store)).toEqual(saved);

    const old = memoryStore({ [PROGRESS_KEY]: JSON.stringify({ v: 2, bests: {} }) });
    expect(loadProgress(old)).toMatchObject({ xp: 0, history: [], roundsPlayed: 0 });
    // Older data with a history but no counter counts at least those Rounds.
    const noCounter = memoryStore({ [PROGRESS_KEY]: JSON.stringify({ v: 2, history: saved.history }) });
    expect(loadProgress(noCounter).roundsPlayed).toBe(1);

    const corrupt = memoryStore({ [PROGRESS_KEY]: JSON.stringify({ v: 2, bests: {}, xp: -3, history: 'nope' }) });
    expect(loadProgress(corrupt)).toMatchObject({ xp: 0, history: [] });

    const mixed = memoryStore({
      [PROGRESS_KEY]: JSON.stringify({
        v: 2,
        xp: 7.5,
        history: [saved.history[0], { date: 'x', mode: 'nope', quiz: 'flags', points: 1, correct: 1, answered: 1 }, null],
      }),
    });
    expect(loadProgress(mixed)).toMatchObject({ xp: 0, history: saved.history });

    expect(resetProgress(store)).toMatchObject({ xp: 0, history: [], roundsPlayed: 0 });
    expect(loadProgress(store)).toEqual(emptyProgress());
  });
});

describe('Stats', () => {
  it('is empty with no rounds', () => {
    const stats = computeStats(emptyProgress());
    expect(stats.empty).toBe(true);
    expect(stats).toMatchObject({ rounds: 0, answers: 0, accuracy: null, mostMissed: [], recentPoints: [] });
    expect(stats.continents.every((c) => c.accuracy === null)).toBe(true);
  });

  it('totals, per-continent accuracy, most missed and recent points', () => {
    let progress: Progress = {
      ...emptyProgress(),
      passport: {
        fr: { seen: 5, correct: 1 },
        de: { seen: 3, correct: 3 },
        jp: { seen: 4, correct: 2 },
        br: { seen: 2, correct: 1 },
        ke: { seen: 3, correct: 0 },
        au: { seen: 1, correct: 0 },
        us: { seen: 2, correct: 1 },
      },
    };
    for (let i = 0; i < 25; i++) progress = recordHistory(progress, result({ points: i * 10, correct: 5, answered: 10 }), 'd');
    const stats = computeStats(progress);
    expect(stats.empty).toBe(false);
    expect(stats).toMatchObject({ rounds: 25, answers: 250, correct: 125, accuracy: 0.5 });
    expect(stats.continents.find((c) => c.continent === 'europe')).toEqual({ continent: 'europe', answered: 8, correct: 4, accuracy: 0.5 });
    expect(stats.mostMissed.map((m) => m.code)).toEqual(['fr', 'ke', 'jp', 'au', 'br']);
    expect(stats.recentPoints).toHaveLength(20);
    expect(stats.recentPoints[0]).toBe(50);
    expect(stats.recentPoints[19]).toBe(240);
  });
});

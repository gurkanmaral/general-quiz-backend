import type { LobbyRemoved, LobbyState, PlayerCard } from '@general-quiz/contracts';
import { LobbyActor, type GameQuestion, type LobbyEnv } from '../src/modules/lobbies';
import { ManualClock } from './clock';

const text = (en: string) => ({ en });

/** Question `n` of a test Quiz; its correct option is `n % 4`. */
export function testQuestion(n: number): GameQuestion {
  return {
    slug: `q${n}`,
    difficulty: n % 3 === 0 ? 'expert' : 'standard',
    eyebrow: text(`Eyebrow ${n}`),
    text: text(`Question ${n}?`),
    options: [text('A'), text('B'), text('C'), text('D')],
    correctIndex: n % 4,
    answerTitle: text(`Answer ${n}`),
    summary: text(`Story ${n}`),
  };
}

export const card = (n: number): PlayerCard => ({ id: `p${n}`, username: `P${n}`, avatar: null, title: null });

export type Recorded = { states: Map<string, LobbyState[]>; removals: [string, LobbyRemoved][]; closed: number };

/**
 * A Lobby actor with simulated clients: every `publish` lands in `states` per player, so tests can
 * read exactly what each player was sent. Player `p0` is Host.
 */
export function testLobby(options: { questions?: number; clock?: ManualClock; extra?: Partial<LobbyEnv> } = {}) {
  const clock = options.clock ?? new ManualClock();
  const recorded: Recorded = { states: new Map(), removals: [], closed: 0 };
  const env: LobbyEnv = {
    clock,
    playerCard: async (id) => card(Number(id.slice(1))),
    quiz: async (slug) => ({ slug, title: text(slug) }),
    questions: async (_slug, count) => Array.from({ length: Math.min(count, options.questions ?? 3) }, (_, i) => testQuestion(i + 1)),
    publish: (userId, state) => recorded.states.set(userId, [...(recorded.states.get(userId) ?? []), state]),
    removed: (userId, event) => recorded.removals.push([userId, event]),
    closed: () => (recorded.closed += 1),
    ...options.extra,
  };
  const lobby = new LobbyActor('ABCDEF', card(0), { slug: 'quiz', title: text('Quiz') }, { questionCount: 10, timeLimitS: 20 }, env);
  const last = (userId: string): LobbyState => {
    const list = recorded.states.get(userId);
    if (!list?.length) throw new Error(`${userId} got no state`);
    return list[list.length - 1]!;
  };
  return { lobby, clock, recorded, last };
}

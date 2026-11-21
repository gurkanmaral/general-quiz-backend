import { randomInt } from 'node:crypto';
import { LOBBY_CODE_ALPHABET, LOBBY_QUESTION_COUNT, LOBBY_TIME_LIMIT_S, type LobbyRemoved, type LobbyState, type PlayerCard } from '@general-quiz/contracts';
import { LobbyActor, systemClock, type Clock, type GameQuestion, type GameResult, type LobbyEnv, type LobbyQuiz } from './actor';
import type { UnlockedAward } from '@general-quiz/contracts';

export type HubDeps = {
  clock?: Clock;
  playerCard: (userId: string) => Promise<PlayerCard | undefined>;
  quiz: (slug: string) => Promise<LobbyQuiz | undefined>;
  questions: (quizSlug: string, count: number) => Promise<GameQuestion[]>;
  recordGame?: (result: GameResult) => Promise<Map<string, UnlockedAward[]>>;
  onError?: (error: unknown) => void;
  /** Random code characters; injectable for tests. */
  randomIndex?: (max: number) => number;
};

/** Delivery to sockets, set by the realtime layer. Until then, nothing is sent. */
export type LobbyTransport = {
  publish: (code: string, userId: string, state: LobbyState) => void;
  removed: (code: string, userId: string, event: LobbyRemoved) => void;
};

export type CreateResult = { ok: true; code: string } | { ok: false; reason: 'quizNotFound' | 'profileIncomplete' };

/** Every live Lobby on this API instance (AD-8: one instance, Lobbies live in memory). */
export function createLobbyHub(deps: HubDeps) {
  const clock = deps.clock ?? systemClock;
  const randomIndex = deps.randomIndex ?? ((max: number) => randomInt(max));
  const lobbies = new Map<string, LobbyActor>();
  let transport: LobbyTransport = { publish: () => {}, removed: () => {} };

  function newCode(): string {
    for (;;) {
      const code = Array.from({ length: 6 }, () => LOBBY_CODE_ALPHABET[randomIndex(LOBBY_CODE_ALPHABET.length)]).join('');
      if (!lobbies.has(code)) return code;
    }
  }

  function envFor(code: string): LobbyEnv {
    return {
      clock,
      playerCard: deps.playerCard,
      quiz: deps.quiz,
      questions: deps.questions,
      recordGame: deps.recordGame,
      onError: deps.onError,
      publish: (userId, state) => transport.publish(code, userId, state),
      removed: (userId, event) => transport.removed(code, userId, event),
      closed: () => lobbies.delete(code),
    };
  }

  return {
    setTransport(next: LobbyTransport) {
      transport = next;
    },

    /** Opens a Lobby for a Quiz with default settings; the creator is Host (FR-27). */
    async create(hostId: string, quizSlug: string): Promise<CreateResult> {
      const [host, quiz] = await Promise.all([deps.playerCard(hostId), deps.quiz(quizSlug)]);
      if (!host) return { ok: false, reason: 'profileIncomplete' };
      if (!quiz) return { ok: false, reason: 'quizNotFound' };
      const code = newCode();
      lobbies.set(code, new LobbyActor(code, host, quiz, { questionCount: LOBBY_QUESTION_COUNT.default, timeLimitS: LOBBY_TIME_LIMIT_S.default }, envFor(code)));
      return { ok: true, code };
    },

    get(code: string): LobbyActor | undefined {
      return lobbies.get(code);
    },

    /** True when both players are in one live Lobby (Lobby co-players may see Profiles, FR-20). */
    together(a: string, b: string): boolean {
      for (const lobby of lobbies.values()) if (lobby.has(a) && lobby.has(b)) return true;
      return false;
    },

    get size() {
      return lobbies.size;
    },
  };
}
export type LobbyHub = ReturnType<typeof createLobbyHub>;

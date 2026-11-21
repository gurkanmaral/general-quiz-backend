import {
  lobbyPoints,
  type LobbyPodium,
  type LobbyStanding,
  type UnlockedAward,
  type QuestionDifficulty,
  LOBBY_MAX_PLAYERS,
  LOBBY_PROBLEM_CODES,
  type LobbyAck,
  type LobbyProblemCode,
  type LobbyRemoved,
  type LobbySettings,
  type LobbySettingsUpdate,
  type LobbyState,
  type LocalizedText,
  type PlayerCard,
} from '@general-quiz/contracts';

/** The server clock and timers (AD-8). Tests inject a manual clock. */
export type Clock = {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A disconnected player is kept this long before leaving the waiting room (refreshes, flaky networks). */
export const DISCONNECT_GRACE_MS = 30_000;
/** A Lobby with nobody connected closes after this long. */
export const IDLE_CLOSE_MS = 10 * 60_000;

/** How long the answer and leaderboard show before the next Question. */
export const REVEAL_MS = 6_000;

export type LobbyQuiz = { slug: string; title: LocalizedText };

/** A drawn Question with its answer; only the server holds `correctIndex` until the reveal (AD-7). */
export type GameQuestion = {
  slug: string;
  difficulty: QuestionDifficulty;
  eyebrow: LocalizedText;
  text: LocalizedText;
  options: LocalizedText[];
  correctIndex: number;
  answerTitle: LocalizedText;
  summary: LocalizedText;
};

type Answer = { selectedIndex: number; elapsedMs: number };
/** One player's game: points, correct count, and per-Question outcomes for Quiz Records. */
type PlayerGame = { card: PlayerCard; score: number; correct: number; outcomes: { questionSlug: string; correct: boolean }[] };

/** A finished game as the app records it: Quiz Records through `progress`, results in `lobbies`. */
export type GameResult = {
  code: string;
  quizSlug: string;
  questionCount: number;
  standings: LobbyStanding[];
  /** Each player's answered Questions (missed ones are not answers, FR-15). */
  outcomes: Map<string, { questionSlug: string; correct: boolean }[]>;
};

type Game = {
  questions: GameQuestion[];
  index: number;
  limitMs: number;
  startedAt: number;
  deadline: number;
  /** Answers to the current Question, by player. */
  answers: Map<string, Answer>;
  /** Everyone who plays this game (players present at Start). */
  players: Map<string, PlayerGame>;
  /** Points of the last ended Question, by player. */
  lastResults: Map<string, { selectedIndex: number | null; correct: boolean; points: number }>;
  nextAt: number;
  timer: unknown;
};

/** What the actor needs from the rest of the app; all of it is injected (AD-2). */
export type LobbyEnv = {
  clock: Clock;
  /** Username, avatar and equipped Title of a player with a finished profile. */
  playerCard: (userId: string) => Promise<PlayerCard | undefined>;
  /** A published Quiz that can be played, or undefined. */
  quiz: (slug: string) => Promise<LobbyQuiz | undefined>;
  /** Records a finished game; resolves to each player's new Badges and Titles (FR-34). */
  recordGame?: (result: GameResult) => Promise<Map<string, UnlockedAward[]>>;
  /** Reports a failure the players should not see (e.g. recording failed). */
  onError?: (error: unknown) => void;
  /** Draws up to `count` published Questions of a Quiz (from `quizzes`). */
  questions: (quizSlug: string, count: number) => Promise<GameQuestion[]>;
  /** Delivers a player's view to every socket of theirs in this Lobby. */
  publish: (userId: string, state: LobbyState) => void;
  /** Tells a player they are no longer in the Lobby. */
  removed: (userId: string, event: LobbyRemoved) => void;
  /** Called once when the Lobby closes (last player gone, or idle). */
  closed: () => void;
};

type Player = {
  card: PlayerCard;
  /** Joining order; the lowest present player is the longest present (FR-30). */
  seq: number;
  sockets: Set<string>;
  graceTimer: unknown;
};

const fail = (code: LobbyProblemCode): LobbyAck => ({ ok: false, code });
const OK: LobbyAck = { ok: true };

/**
 * One Lobby as a single-writer actor (AD-8): every command runs through one serial queue, so
 * joins, settings, answers and timers never interleave. Timing uses the injected server clock.
 */
export class LobbyActor {
  readonly players = new Map<string, Player>();
  private readonly kicked = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;
  private idleTimer: unknown;
  hostId: string;
  settings: LobbySettings;
  quiz: LobbyQuiz;
  phase: LobbyState['phase'] = 'waiting';
  isClosed = false;
  protected game: Game | undefined;
  private podium: LobbyPodium | null = null;

  constructor(
    readonly code: string,
    host: PlayerCard,
    quiz: LobbyQuiz,
    settings: Omit<LobbySettings, 'quizSlug'>,
    protected readonly env: LobbyEnv,
  ) {
    this.hostId = host.id;
    this.quiz = quiz;
    this.settings = { quizSlug: quiz.slug, ...settings };
    this.addPlayer(host);
    this.scheduleIdle();
  }

  /** Runs `command` after every earlier one has finished (the serial queue). */
  protected run<T>(command: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(() => (this.isClosed ? (fail(LOBBY_PROBLEM_CODES.notFound) as T) : command()));
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Resolves once every queued command has run (tests and shutdown). */
  async idle(): Promise<void> {
    let seen: Promise<unknown>;
    do {
      seen = this.queue;
      await seen;
    } while (seen !== this.queue);
  }

  has(userId: string): boolean {
    return this.players.has(userId);
  }

  private addPlayer(card: PlayerCard): Player {
    const player: Player = { card, seq: this.seq++, sockets: new Set(), graceTimer: undefined };
    this.players.set(card.id, player);
    return player;
  }

  /** Joins (or rejoins) with one socket. New players only while waiting, up to 20 (FR-28). */
  join(userId: string, socketId: string): Promise<LobbyAck> {
    return this.run(async () => {
      if (this.kicked.has(userId)) return fail(LOBBY_PROBLEM_CODES.kicked);
      let player = this.players.get(userId);
      if (!player) {
        if (this.phase !== 'waiting') return fail(LOBBY_PROBLEM_CODES.inProgress);
        if (this.players.size >= LOBBY_MAX_PLAYERS) return fail(LOBBY_PROBLEM_CODES.full);
        const card = await this.env.playerCard(userId);
        if (!card) return fail(LOBBY_PROBLEM_CODES.profileIncomplete);
        player = this.addPlayer(card);
      }
      player.sockets.add(socketId);
      this.env.clock.clearTimeout(player.graceTimer);
      player.graceTimer = undefined;
      this.changed();
      return OK;
    });
  }

  /** A socket went away; after a grace period without sockets the player leaves the waiting room. */
  disconnect(userId: string, socketId: string): Promise<void> {
    return this.run(() => {
      const player = this.players.get(userId);
      if (!player || !player.sockets.delete(socketId) || player.sockets.size > 0) return;
      player.graceTimer = this.env.clock.setTimeout(() => void this.expire(userId), DISCONNECT_GRACE_MS);
      this.changed();
      // Nobody waits for a player who dropped mid-Question.
      this.endIfAllAnswered();
    });
  }

  private expire(userId: string): Promise<void> {
    return this.run(() => {
      const player = this.players.get(userId);
      if (!player || player.sockets.size > 0) return;
      player.graceTimer = undefined;
      if (this.canDropPlayers()) {
        this.removePlayer(userId);
      } else if (userId === this.hostId) {
        // Mid-game the player keeps their place (rejoin, FR-33), but someone present hosts.
        this.passHost();
      }
      this.changed();
    });
  }

  /** Players leave for good only outside a running game (a running game keeps their place). */
  protected canDropPlayers(): boolean {
    return this.phase === 'waiting' || this.phase === 'podium';
  }

  /** Host only: draws the Questions and starts the game with everyone present (FR-31). */
  start(userId: string): Promise<LobbyAck> {
    return this.run(async () => {
      if (!this.players.has(userId)) return fail(LOBBY_PROBLEM_CODES.notInLobby);
      if (userId !== this.hostId) return fail(LOBBY_PROBLEM_CODES.notHost);
      if (this.phase !== 'waiting') return fail(LOBBY_PROBLEM_CODES.wrongPhase);
      const questions = await this.env.questions(this.quiz.slug, this.settings.questionCount);
      if (questions.length === 0) return fail(LOBBY_PROBLEM_CODES.noQuestions);
      const players = new Map<string, PlayerGame>([...this.players.entries()].map(([id, player]) => [id, { card: player.card, score: 0, correct: 0, outcomes: [] }]));
      this.podium = null;
      this.game = { questions, index: -1, limitMs: this.settings.timeLimitS * 1000, startedAt: 0, deadline: 0, answers: new Map(), players, lastResults: new Map(), nextAt: 0, timer: undefined };
      this.beginQuestion(0);
      return OK;
    });
  }

  private beginQuestion(index: number): void {
    const game = this.game!;
    const now = this.env.clock.now();
    game.index = index;
    game.startedAt = now;
    game.deadline = now + game.limitMs;
    game.answers = new Map();
    this.phase = 'question';
    game.timer = this.env.clock.setTimeout(() => void this.run(() => this.endQuestion(index)), game.limitMs);
    this.changed();
  }

  /**
   * Locks a player's first answer (FR-31). Timing uses when the server received it, read before
   * the command waits in the queue, so queueing never costs points (FR-32, AD-8).
   */
  answer(userId: string, index: number, selectedIndex: number): Promise<LobbyAck> {
    const receivedAt = this.env.clock.now();
    return this.run(() => {
      const game = this.game;
      if (!game?.players.has(userId) || !this.players.has(userId)) return fail(LOBBY_PROBLEM_CODES.notInLobby);
      if (this.phase !== 'question' || index !== game.index) return fail(index < game.index || this.phase === 'reveal' ? LOBBY_PROBLEM_CODES.tooLate : LOBBY_PROBLEM_CODES.wrongPhase);
      if (game.answers.has(userId)) return fail(LOBBY_PROBLEM_CODES.alreadyAnswered);
      const elapsedMs = receivedAt - game.startedAt;
      if (elapsedMs > game.limitMs) return fail(LOBBY_PROBLEM_CODES.tooLate);
      game.answers.set(userId, { selectedIndex, elapsedMs: Math.max(0, elapsedMs) });
      this.changed();
      this.endIfAllAnswered();
      return OK;
    });
  }

  /** The Question ends as soon as every connected player in the game has answered (FR-31). */
  private endIfAllAnswered(): void {
    const game = this.game;
    if (!game || this.phase !== 'question') return;
    const waiting = [...game.players.keys()].some((id) => (this.players.get(id)?.sockets.size ?? 0) > 0 && !game.answers.has(id));
    if (!waiting) this.endQuestion(game.index);
  }

  /** Scores the Question, reveals the answer and the leaderboard, then schedules what comes next (FR-32). */
  private endQuestion(index: number): void {
    const game = this.game;
    if (!game || this.phase !== 'question' || game.index !== index) return;
    this.env.clock.clearTimeout(game.timer);
    const question = game.questions[index]!;
    game.lastResults = new Map();
    for (const [id, record] of game.players) {
      const answer = game.answers.get(id);
      const correct = answer?.selectedIndex === question.correctIndex;
      const points = lobbyPoints(correct, answer?.elapsedMs ?? game.limitMs, game.limitMs);
      record.score += points;
      if (correct) record.correct += 1;
      // Only answered Questions go into the Quiz Record (FR-15); a missed one just scores 0.
      if (answer) record.outcomes.push({ questionSlug: question.slug, correct });
      game.lastResults.set(id, { selectedIndex: answer?.selectedIndex ?? null, correct, points });
    }
    this.phase = 'reveal';
    game.nextAt = this.env.clock.now() + REVEAL_MS;
    game.timer = this.env.clock.setTimeout(() => void this.run(() => this.advance(index)), REVEAL_MS);
    this.changed();
  }

  private async advance(index: number): Promise<void> {
    const game = this.game;
    if (!game || this.phase !== 'reveal' || game.index !== index) return;
    if (index + 1 < game.questions.length) this.beginQuestion(index + 1);
    else await this.finish();
  }

  /**
   * The last Question ended (FR-34): records the game (Quiz Records, Badges and Titles through
   * `progress`), then shows everyone the podium and full ranking with what each player unlocked.
   */
  protected async finish(): Promise<void> {
    const game = this.game!;
    const standings = this.standings();
    let unlocks = new Map<string, UnlockedAward[]>();
    try {
      if (this.env.recordGame) {
        unlocks = await this.env.recordGame({
          code: this.code,
          quizSlug: this.quiz.slug,
          questionCount: game.questions.length,
          standings,
          outcomes: new Map([...game.players.entries()].map(([id, record]) => [id, record.outcomes])),
        });
      }
    } catch (error) {
      // The podium still shows; only the progress update is lost.
      this.env.onError?.(error);
    }
    this.podium = {
      ranking: standings.map((standing) => ({ ...standing, player: game.players.get(standing.userId)!.card, unlocks: unlocks.get(standing.userId) ?? [] })),
    };
    this.phase = 'podium';
    // Players who never came back now leave after the usual grace period.
    for (const [userId, player] of this.players) {
      if (player.sockets.size === 0 && player.graceTimer === undefined) {
        player.graceTimer = this.env.clock.setTimeout(() => void this.expire(userId), DISCONNECT_GRACE_MS);
      }
    }
    this.changed();
  }

  /** Host only, from the podium: back to the waiting room with the same players (FR-34). */
  playAgain(userId: string): Promise<LobbyAck> {
    return this.run(() => {
      if (!this.players.has(userId)) return fail(LOBBY_PROBLEM_CODES.notInLobby);
      if (userId !== this.hostId) return fail(LOBBY_PROBLEM_CODES.notHost);
      if (this.phase !== 'podium') return fail(LOBBY_PROBLEM_CODES.wrongPhase);
      this.game = undefined;
      this.podium = null;
      this.phase = 'waiting';
      this.changed();
      return OK;
    });
  }

  /** Everyone in the current or last game, best first; equal scores share a rank. */
  standings(): LobbyStanding[] {
    const game = this.game;
    if (!game) return [];
    const seqOf = (id: string) => this.players.get(id)?.seq ?? Number.MAX_SAFE_INTEGER;
    const sorted = [...game.players.entries()].sort((a, b) => b[1].score - a[1].score || b[1].correct - a[1].correct || seqOf(a[0]) - seqOf(b[0]));
    let rank = 0;
    return sorted.map(([userId, record], position) => {
      if (position === 0 || sorted[position - 1]![1].score !== record.score) rank = position + 1;
      return { userId, score: record.score, correct: record.correct, rank };
    });
  }

  /** Leaves the Lobby by choice. */
  leave(userId: string): Promise<LobbyAck> {
    return this.run(() => {
      if (!this.players.has(userId)) return fail(LOBBY_PROBLEM_CODES.notInLobby);
      this.removePlayer(userId);
      this.changed();
      return OK;
    });
  }

  /** Host only, while waiting: Quiz, Question count (5–20) and time per Question (10–30 s) (FR-30). */
  updateSettings(userId: string, update: LobbySettingsUpdate): Promise<LobbyAck> {
    return this.run(async () => {
      if (!this.players.has(userId)) return fail(LOBBY_PROBLEM_CODES.notInLobby);
      if (userId !== this.hostId) return fail(LOBBY_PROBLEM_CODES.notHost);
      if (this.phase !== 'waiting') return fail(LOBBY_PROBLEM_CODES.wrongPhase);
      if (update.quizSlug && update.quizSlug !== this.quiz.slug) {
        const quiz = await this.env.quiz(update.quizSlug);
        if (!quiz) return fail(LOBBY_PROBLEM_CODES.quizNotFound);
        this.quiz = quiz;
      }
      this.settings = { ...this.settings, ...update, quizSlug: this.quiz.slug };
      this.changed();
      return OK;
    });
  }

  /** Host only: removes a player, who cannot come back to this Lobby (FR-30). */
  kick(userId: string, targetId: string): Promise<LobbyAck> {
    return this.run(() => {
      if (!this.players.has(userId)) return fail(LOBBY_PROBLEM_CODES.notInLobby);
      if (userId !== this.hostId) return fail(LOBBY_PROBLEM_CODES.notHost);
      if (targetId === userId || !this.players.has(targetId)) return fail(LOBBY_PROBLEM_CODES.unknownPlayer);
      this.kicked.add(targetId);
      this.removePlayer(targetId);
      this.env.removed(targetId, { reason: 'kicked' });
      this.changed();
      return OK;
    });
  }

  protected removePlayer(userId: string): void {
    const player = this.players.get(userId);
    if (!player) return;
    this.env.clock.clearTimeout(player.graceTimer);
    this.players.delete(userId);
    this.onPlayerRemoved(userId);
    if (userId === this.hostId) this.passHost();
  }

  /** A player who leaves mid-game leaves the game too; nobody waits for them. */
  protected onPlayerRemoved(userId: string): void {
    if (!this.game || this.phase === 'podium') return;
    this.game.players.delete(userId);
    this.game.answers.delete(userId);
    if (this.game.players.size > 0) this.endIfAllAnswered();
  }

  /** Host passes to the longest-present player, preferring connected ones (FR-30). */
  protected passHost(): void {
    const ordered = [...this.players.entries()].sort((a, b) => a[1].seq - b[1].seq);
    const next = ordered.find(([, player]) => player.sockets.size > 0) ?? ordered[0];
    if (next) this.hostId = next[0];
  }

  /** After every change: close when empty, keep the idle timer in step, publish everyone's view. */
  protected changed(): void {
    if (this.players.size === 0) {
      this.close();
      return;
    }
    this.scheduleIdle();
    for (const [userId, player] of this.players) if (player.sockets.size > 0) this.env.publish(userId, this.view(userId));
  }

  private scheduleIdle(): void {
    this.env.clock.clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    const anyoneConnected = [...this.players.values()].some((player) => player.sockets.size > 0);
    if (!anyoneConnected) this.idleTimer = this.env.clock.setTimeout(() => void this.run(() => this.closeWithNotice()), IDLE_CLOSE_MS);
  }

  private closeWithNotice(): void {
    for (const userId of this.players.keys()) this.env.removed(userId, { reason: 'closed' });
    this.close();
  }

  protected close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.env.clock.clearTimeout(this.idleTimer);
    for (const player of this.players.values()) this.env.clock.clearTimeout(player.graceTimer);
    this.clearTimers();
    this.env.closed();
  }

  protected clearTimers(): void {
    if (this.game) this.env.clock.clearTimeout(this.game.timer);
  }

  protected playerViews() {
    const game = this.game;
    return [...this.players.values()]
      .sort((a, b) => a.seq - b.seq)
      .map((player) => ({
        ...player.card,
        connected: player.sockets.size > 0,
        score: this.phase === 'waiting' ? 0 : (game?.players.get(player.card.id)?.score ?? 0),
        answered: this.phase === 'question' && Boolean(game?.answers.has(player.card.id)),
      }));
  }

  /** What `userId` may see right now: the running Question never carries its answer (AD-7). */
  view(userId: string): LobbyState {
    const game = this.game;
    const iso = (ms: number) => new Date(ms).toISOString();
    const now = this.env.clock.now();
    const current = game?.questions[game.index];
    const question =
      this.phase === 'question' && game && current
        ? {
            index: game.index,
            total: game.questions.length,
            difficulty: current.difficulty,
            eyebrow: current.eyebrow,
            text: current.text,
            options: current.options,
            startedAt: iso(game.startedAt),
            deadline: iso(game.deadline),
            serverNow: iso(now),
            limitMs: game.limitMs,
            myAnswer: game.answers.get(userId)?.selectedIndex ?? null,
          }
        : null;
    const reveal =
      this.phase === 'reveal' && game && current
        ? {
            index: game.index,
            total: game.questions.length,
            difficulty: current.difficulty,
            text: current.text,
            options: current.options,
            correctIndex: current.correctIndex,
            answerTitle: current.answerTitle,
            summary: current.summary,
            results: [...game.lastResults.entries()].map(([id, result]) => ({ userId: id, ...result })),
            nextAt: iso(game.nextAt),
            serverNow: iso(now),
          }
        : null;
    return {
      code: this.code,
      hostId: this.hostId,
      me: userId,
      quiz: this.quiz,
      settings: this.settings,
      players: this.playerViews(),
      phase: this.phase,
      question,
      reveal,
      leaderboard: this.phase === 'waiting' ? [] : this.standings(),
      podium: this.phase === 'podium' ? this.podium : null,
    };
  }
}

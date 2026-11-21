import {
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

export type LobbyQuiz = { slug: string; title: LocalizedText };

/** What the actor needs from the rest of the app; all of it is injected (AD-2). */
export type LobbyEnv = {
  clock: Clock;
  /** Username, avatar and equipped Title of a player with a finished profile. */
  playerCard: (userId: string) => Promise<PlayerCard | undefined>;
  /** A published Quiz that can be played, or undefined. */
  quiz: (slug: string) => Promise<LobbyQuiz | undefined>;
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
    return this.phase === 'waiting';
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

  /** Hook for game state when a player leaves for good. */
  protected onPlayerRemoved(_userId: string): void {}

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

  /** Hook: game timers to cancel on close. */
  protected clearTimers(): void {}

  protected playerViews() {
    return [...this.players.values()].sort((a, b) => a.seq - b.seq).map((player) => ({ ...player.card, connected: player.sockets.size > 0 }));
  }

  /** What `userId` may see right now. */
  view(userId: string): LobbyState {
    return {
      code: this.code,
      hostId: this.hostId,
      me: userId,
      quiz: this.quiz,
      settings: this.settings,
      players: this.playerViews(),
      phase: this.phase,
    };
  }
}

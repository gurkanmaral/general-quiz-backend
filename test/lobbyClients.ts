import { expect } from 'vitest';
import type { Socket } from 'socket.io-client';
import { LOBBY_EVENTS, LOBBY_NAMESPACE, LobbyStateSchema, type LobbyAck, type LobbyRemoved, type LobbyState } from '@general-quiz/contracts';
import { connected, socketFor } from './realtime';

/** A simulated player's Lobby socket that keeps every state it receives. */
export class LobbyClient {
  readonly states: LobbyState[] = [];
  readonly removals: LobbyRemoved[] = [];
  socket!: Socket;

  constructor(
    readonly name: string,
    private readonly url: string,
    private readonly cookie: string,
  ) {}

  async connect(): Promise<this> {
    this.socket = socketFor(this.url, LOBBY_NAMESPACE, this.cookie);
    this.socket.on(LOBBY_EVENTS.state, (state: unknown) => this.states.push(LobbyStateSchema.parse(state)));
    this.socket.on(LOBBY_EVENTS.removed, (event: LobbyRemoved) => this.removals.push(event));
    await connected(this.socket);
    return this;
  }

  get state(): LobbyState {
    const last = this.states[this.states.length - 1];
    if (!last) throw new Error(`${this.name} has no state yet`);
    return last;
  }

  send(event: string, payload?: unknown): Promise<LobbyAck> {
    return this.socket.timeout(2000).emitWithAck(event, payload) as Promise<LobbyAck>;
  }

  async ok(event: string, payload?: unknown): Promise<void> {
    expect(await this.send(event, payload)).toEqual({ ok: true });
  }

  close(): void {
    this.socket.close();
  }
}

/** Polls until `check` passes (socket deliveries are asynchronous). */
export async function until(check: () => boolean | void, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      if (check() !== false) return;
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error;
    }
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

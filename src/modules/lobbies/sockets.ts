import type { Namespace, Socket } from 'socket.io';
import {
  LOBBY_COMMANDS,
  LOBBY_EVENTS,
  LOBBY_PROBLEM_CODES,
  LobbyAnswerSchema,
  LobbyJoinSchema,
  LobbyKickSchema,
  LobbySettingsUpdateSchema,
  type LobbyAck,
} from '@general-quiz/contracts';
import type { LobbyActor } from './actor';
import type { LobbyHub } from './hub';

const room = (code: string, userId: string) => `lobby:${code}:${userId}`;
type Ack = (ack: LobbyAck) => void;

/**
 * The `/lobby` namespace (AD-8): sockets send commands to their Lobby's actor and receive their own
 * view after every change. Authentication runs before (`socket.data.userId`).
 */
export function attachLobbySockets(nsp: Namespace, hub: LobbyHub): void {
  hub.setTransport({
    publish: (code, userId, state) => nsp.to(room(code, userId)).emit(LOBBY_EVENTS.state, state),
    removed: (code, userId, event) => {
      nsp.to(room(code, userId)).emit(LOBBY_EVENTS.removed, event);
      nsp.in(room(code, userId)).socketsLeave(room(code, userId));
    },
  });

  nsp.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    let current: LobbyActor | undefined;

    /** Wraps a command handler: validates the ack callback and turns errors into a failed ack. */
    const on = (event: string, handler: (payload: unknown) => Promise<LobbyAck>) => {
      socket.on(event, async (payload: unknown, ack?: Ack) => {
        let result: LobbyAck;
        try {
          result = await handler(payload);
        } catch {
          result = { ok: false, code: LOBBY_PROBLEM_CODES.invalid };
        }
        if (typeof ack === 'function') ack(result);
      });
    };
    const inLobby = (handler: (actor: LobbyActor, payload: unknown) => Promise<LobbyAck>) => async (payload: unknown) =>
      current && !current.isClosed ? handler(current, payload) : ({ ok: false, code: LOBBY_PROBLEM_CODES.notInLobby } as const);

    on(LOBBY_COMMANDS.join, async (payload) => {
      const parsed = LobbyJoinSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, code: LOBBY_PROBLEM_CODES.invalid };
      const actor = hub.get(parsed.data.code);
      if (!actor) return { ok: false, code: LOBBY_PROBLEM_CODES.notFound };
      if (current && current !== actor) {
        await socket.leave(room(current.code, userId));
        await current.disconnect(userId, socket.id);
      }
      // Join the room first so the state published by the join reaches this socket.
      await socket.join(room(actor.code, userId));
      const ack = await actor.join(userId, socket.id);
      if (ack.ok) current = actor;
      else {
        await socket.leave(room(actor.code, userId));
        if (current === actor) current = undefined;
      }
      return ack;
    });

    on(
      LOBBY_COMMANDS.leave,
      inLobby(async (actor) => {
        const ack = await actor.leave(userId);
        await socket.leave(room(actor.code, userId));
        current = undefined;
        return ack;
      }),
    );

    on(
      LOBBY_COMMANDS.settings,
      inLobby(async (actor, payload) => {
        const parsed = LobbySettingsUpdateSchema.safeParse(payload);
        return parsed.success ? actor.updateSettings(userId, parsed.data) : { ok: false, code: LOBBY_PROBLEM_CODES.invalid };
      }),
    );

    on(
      LOBBY_COMMANDS.kick,
      inLobby(async (actor, payload) => {
        const parsed = LobbyKickSchema.safeParse(payload);
        return parsed.success ? actor.kick(userId, parsed.data.userId) : { ok: false, code: LOBBY_PROBLEM_CODES.invalid };
      }),
    );

    on(
      LOBBY_COMMANDS.start,
      inLobby((actor) => actor.start(userId)),
    );

    on(
      LOBBY_COMMANDS.answer,
      inLobby(async (actor, payload) => {
        const parsed = LobbyAnswerSchema.safeParse(payload);
        return parsed.success ? actor.answer(userId, parsed.data.index, parsed.data.selectedIndex) : { ok: false, code: LOBBY_PROBLEM_CODES.invalid };
      }),
    );

    socket.on('disconnect', () => {
      if (current) void current.disconnect(userId, socket.id);
    });
  });
}

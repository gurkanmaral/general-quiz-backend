import type { IncomingHttpHeaders, Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { LOBBY_NAMESPACE, NOTIFICATION_EVENT, NOTIFICATIONS_NAMESPACE, SOCKET_PATH, UNREAD_EVENT } from '../contracts';
import { attachLobbySockets } from '../modules/lobbies';
import type { Logger } from '../logger';
import type { createApp } from './app';

type App = ReturnType<typeof createApp>;

export type RealtimeOptions = {
  /** Browser origins allowed to open sockets (the web app's origin, AD-12). */
  trustedOrigins: readonly string[];
  logger?: Logger;
};

function toHeaders(source: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}

/** The player's Better Auth session (cookie, or `auth.token` as a bearer token for native clients). */
export function socketAuth(app: App) {
  return async (socket: Socket, next: (error?: Error) => void) => {
    try {
      const headers = toHeaders(socket.request.headers);
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token === 'string' && token) headers.set('authorization', `Bearer ${token}`);
      const user = await app.accounts.service.sessionUser(headers);
      if (!user) return next(new Error('accounts.unauthorized'));
      socket.data.userId = user.id;
      next();
    } catch {
      next(new Error('accounts.unauthorized'));
    }
  };
}

/**
 * Socket.IO on the API's HTTP server (AD-1, one instance): `/notifications` pushes notifications
 * live to every signed-in socket of the recipient (FR-26); `/lobby` runs Lobbies (FR-27–FR-34).
 */
export function attachRealtime(httpServer: HttpServer, app: App, options: RealtimeOptions): Server {
  const io = new Server(httpServer, {
    path: SOCKET_PATH,
    serveClient: false,
    // Browsers always send Origin on socket requests: only the web app may connect with its cookie.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, !origin || options.trustedOrigins.includes(origin));
    },
  });

  const notifications = io.of(NOTIFICATIONS_NAMESPACE);
  notifications.use(socketAuth(app));
  notifications.on('connection', (socket) => {
    void socket.join(`user:${socket.data.userId as string}`);
  });
  const bus = app.social.notifications.bus;
  bus.on('notification', (userId, event) => notifications.to(`user:${userId}`).emit(NOTIFICATION_EVENT, event));
  bus.on('unread', (userId, unread) => notifications.to(`user:${userId}`).emit(UNREAD_EVENT, { unread }));

  // Lobbies (AD-8): one namespace, each Lobby a server actor.
  const lobby = io.of(LOBBY_NAMESPACE);
  lobby.use(socketAuth(app));
  attachLobbySockets(lobby, app.lobbies);

  options.logger?.debug('realtime attached');
  return io;
}

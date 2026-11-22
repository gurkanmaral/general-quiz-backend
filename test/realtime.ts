import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { io as connect, type Socket } from 'socket.io-client';
import type { Server } from 'socket.io';
import { SOCKET_PATH } from '../src/contracts';
import { attachRealtime } from '../src/http/realtime';
import { ORIGIN, type TestApp } from './auth';

/** The app on a real HTTP server with Socket.IO attached, on a free port. */
export async function listen(app: TestApp): Promise<{ url: string; io: Server; close: () => Promise<void> }> {
  const server: HttpServer = createServer(getRequestListener(app.fetch));
  const io = attachRealtime(server, app, { trustedOrigins: [ORIGIN] });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, io, close: () => new Promise((resolve) => io.close(() => resolve())) };
}

/** A simulated client socket with the player's session cookie. */
export function socketFor(url: string, namespace: string, cookie: string, origin = ORIGIN): Socket {
  return connect(`${url}${namespace}`, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie, Origin: origin },
    forceNew: true,
    reconnection: false,
  });
}

/** Resolves when the socket connects, rejects with the server's error. */
export function connected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (error) => reject(error));
  });
}

/** The next payload of `event`. */
export function next<T>(socket: Socket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${timeoutMs} ms`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

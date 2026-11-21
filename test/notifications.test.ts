import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NOTIFICATION_EVENT,
  NOTIFICATIONS_NAMESPACE,
  NotificationEventSchema,
  NotificationsResponseSchema,
  ProblemSchema,
  UNREAD_EVENT,
  type NotificationEvent,
} from '@general-quiz/contracts';
import { openTestDatabase } from './db';
import { completeProfile, createSignedInUser, createTestApp, jsonRequest } from './auth';
import { connected, listen, next, socketFor } from './realtime';

const database = openTestDatabase();
const db = database.db;
const { app, mailer } = createTestApp(db);
let ada = '';
let bob = '';
let cyd = '';
let server: Awaited<ReturnType<typeof listen>>;

beforeAll(async () => {
  ada = await createSignedInUser(app, mailer, 'ada@example.com');
  bob = await createSignedInUser(app, mailer, 'bob@example.com');
  cyd = await createSignedInUser(app, mailer, 'cyd@example.com');
  for (const [cookie, name] of [[ada, 'Ada'], [bob, 'Bob'], [cyd, 'Cyd']] as const) expect((await completeProfile(app, cookie, name)).status).toBe(200);
  server = await listen(app);
});
afterAll(async () => {
  await server.close();
  await database.close();
});

async function list(cookie: string) {
  const res = await app.request('/api/v1/notifications', jsonRequest('GET', undefined, cookie));
  expect(res.status).toBe(200);
  return NotificationsResponseSchema.parse(await res.json());
}

describe('Notifications (Story 4.2, FR-26)', () => {
  it('need a signed-in player, over REST and over the socket', async () => {
    expect(ProblemSchema.parse(await (await app.request('/api/v1/notifications')).json()).code).toBe('accounts.unauthorized');
    expect((await app.request('/api/v1/notifications/read', jsonRequest('POST'))).status).toBe(401);
    const anonymous = socketFor(server.url, NOTIFICATIONS_NAMESPACE, '');
    await expect(connected(anonymous)).rejects.toThrow('accounts.unauthorized');
    anonymous.close();
  });

  it('refuses sockets from a foreign origin', async () => {
    const foreign = socketFor(server.url, NOTIFICATIONS_NAMESPACE, bob, 'https://evil.example');
    await expect(connected(foreign)).rejects.toThrow();
    foreign.close();
  });

  it('arrive live to an online recipient with the unread count, only for them', async () => {
    const bobSocket = socketFor(server.url, NOTIFICATIONS_NAMESPACE, bob);
    const cydSocket = socketFor(server.url, NOTIFICATIONS_NAMESPACE, cyd);
    await Promise.all([connected(bobSocket), connected(cydSocket)]);
    let cydGot = 0;
    cydSocket.on(NOTIFICATION_EVENT, () => (cydGot += 1));
    const live = next<NotificationEvent>(bobSocket, NOTIFICATION_EVENT);
    expect((await app.request('/api/v1/friends/requests', jsonRequest('POST', { username: 'bob' }, ada))).status).toBe(201);
    const event = NotificationEventSchema.parse(await live);
    expect(event.unread).toBe(1);
    expect(event.notification).toMatchObject({ kind: 'friendRequest', actor: { username: 'Ada', avatar: 'owl' }, read: false });
    expect(cydGot).toBe(0);
    // Sending again does not notify twice.
    expect((await app.request('/api/v1/friends/requests', jsonRequest('POST', { username: 'bob' }, ada))).status).toBe(201);
    expect((await list(bob)).notifications).toHaveLength(1);
    bobSocket.close();
    cydSocket.close();
  });

  it('show on next load when the recipient was offline', async () => {
    expect((await app.request('/api/v1/friends/requests', jsonRequest('POST', { username: 'cyd' }, ada))).status).toBe(201);
    const body = await list(cyd);
    expect(body.unread).toBe(1);
    expect(body.notifications.map((item) => [item.kind, item.actor.username, item.read])).toEqual([['friendRequest', 'Ada', false]]);
  });

  it('opening the list marks every item read, and other devices hear it', async () => {
    const other = socketFor(server.url, NOTIFICATIONS_NAMESPACE, cyd);
    await connected(other);
    const unread = next<{ unread: number }>(other, UNREAD_EVENT);
    const res = await app.request('/api/v1/notifications/read', jsonRequest('POST', undefined, cyd));
    expect(await res.json()).toEqual({ unread: 0 });
    expect(await unread).toEqual({ unread: 0 });
    const body = await list(cyd);
    expect(body.unread).toBe(0);
    expect(body.notifications.every((item) => item.read)).toBe(true);
    expect((await list(bob)).unread).toBe(1);
    other.close();
  });

  it('lists newest first and leaves out notifications from deleted accounts', async () => {
    expect((await app.request('/api/v1/friends/requests', jsonRequest('POST', { username: 'cyd' }, bob))).status).toBe(201);
    expect((await list(cyd)).notifications.map((item) => item.actor.username)).toEqual(['Bob', 'Ada']);
    expect((await app.request('/api/v1/me', jsonRequest('DELETE', { confirm: 'DELETE' }, ada))).status).toBe(204);
    expect((await list(cyd)).notifications.map((item) => item.actor.username)).toEqual(['Bob']);
  });
});

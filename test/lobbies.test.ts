import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CreateLobbyResponseSchema,
  LOBBY_COMMANDS,
  LOBBY_NAMESPACE,
  MeResponseSchema,
  NotificationsResponseSchema,
  ProblemSchema,
  type PlayerCard,
} from '@general-quiz/contracts';
import { eq } from 'drizzle-orm';
import { question } from '../src/db/schema';
import { importContent } from '../src/modules/content';
import { DISCONNECT_GRACE_MS, IDLE_CLOSE_MS, LobbyActor, REVEAL_MS, type LobbyEnv } from '../src/modules/lobbies';
import { openTestDatabase } from './db';
import { completeProfile, createSignedInUser, createTestApp, jsonRequest } from './auth';
import { ManualClock, settle } from './clock';
import { connected, listen, socketFor } from './realtime';
import { LobbyClient, until } from './lobbyClients';

const database = openTestDatabase();
const db = database.db;
const clock = new ManualClock();
const { app, mailer } = createTestApp(db, { lobbyClock: clock, now: () => new Date(clock.now()) });
const CONTENT_DIR = new URL('../../../content', import.meta.url).pathname;
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
let server: Awaited<ReturnType<typeof listen>>;
const clients: LobbyClient[] = [];

beforeAll(async () => {
  await importContent(db, CONTENT_DIR);
  for (const name of ['Ada', 'Bob', 'Cyd', 'Dan']) {
    cookies[name] = await createSignedInUser(app, mailer, `${name.toLowerCase()}@example.com`);
    expect((await completeProfile(app, cookies[name]!, name)).status).toBe(200);
    ids[name] = MeResponseSchema.parse(await (await app.request('/api/v1/me', jsonRequest('GET', undefined, cookies[name]))).json()).id;
  }
  server = await listen(app);
});
afterAll(async () => {
  for (const client of clients) client.close();
  await server.close();
  await database.close();
});

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(ProblemSchema.parse(await res.json()).code).toBe(code);
}
async function createLobby(name: string, quizSlug = 'lord-of-the-rings'): Promise<string> {
  const res = await app.request('/api/v1/lobbies', jsonRequest('POST', { quizSlug }, cookies[name]));
  expect(res.status).toBe(201);
  return CreateLobbyResponseSchema.parse(await res.json()).code;
}
async function client(name: string): Promise<LobbyClient> {
  const created = await new LobbyClient(name, server.url, cookies[name]!).connect();
  clients.push(created);
  return created;
}
const names = (client: LobbyClient) => client.state.players.map((player) => player.username);

describe('create a Lobby (Story 5.1, FR-27)', () => {
  it('needs a signed-in player and a playable Quiz', async () => {
    await expectProblem(await app.request('/api/v1/lobbies', jsonRequest('POST', { quizSlug: 'lord-of-the-rings' })), 401, 'accounts.unauthorized');
    await expectProblem(await app.request('/api/v1/lobbies', jsonRequest('POST', {}, cookies.Ada)), 400, 'lobby.invalid');
    await expectProblem(await app.request('/api/v1/lobbies', jsonRequest('POST', { quizSlug: 'nope' }, cookies.Ada)), 404, 'lobby.quizNotFound');
  });

  it('starts an actor with a short code; the creator is Host', async () => {
    const code = await createLobby('Ada');
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const ada = await client('Ada');
    await ada.ok(LOBBY_COMMANDS.join, { code: code.toLowerCase() });
    expect(ada.state).toMatchObject({
      code,
      hostId: ids.Ada,
      me: ids.Ada,
      phase: 'waiting',
      quiz: { slug: 'lord-of-the-rings', title: { en: 'The Lord of the Rings' } },
      settings: { quizSlug: 'lord-of-the-rings', questionCount: 10, timeLimitS: 20 },
    });
    expect(ada.state.players).toEqual([{ id: ids.Ada, username: 'Ada', avatar: 'owl', title: null, connected: true, score: 0, answered: false }]);
    ada.close();
  });

  it('refuses signed-out sockets', async () => {
    const anonymous = socketFor(server.url, LOBBY_NAMESPACE, '');
    await expect(connected(anonymous)).rejects.toThrow('accounts.unauthorized');
    anonymous.close();
  });
});

describe('waiting room and Host controls (Story 5.1, FR-28, FR-30)', () => {
  let code = '';
  let ada: LobbyClient;
  let bob: LobbyClient;
  let cyd: LobbyClient;

  beforeAll(async () => {
    code = await createLobby('Ada');
    ada = await client('Ada');
    bob = await client('Bob');
    cyd = await client('Cyd');
  });

  it('joins by code and shows everyone live; unknown codes are refused', async () => {
    await ada.ok(LOBBY_COMMANDS.join, { code });
    expect(await bob.send(LOBBY_COMMANDS.join, { code: 'ZZZZZZ' })).toEqual({ ok: false, code: 'lobby.notFound' });
    expect(await bob.send(LOBBY_COMMANDS.join, { code: '??' })).toEqual({ ok: false, code: 'lobby.invalid' });
    await bob.ok(LOBBY_COMMANDS.join, { code });
    await cyd.ok(LOBBY_COMMANDS.join, { code });
    await until(() => expect(names(ada)).toEqual(['Ada', 'Bob', 'Cyd']));
    expect(names(bob)).toEqual(['Ada', 'Bob', 'Cyd']);
    expect(bob.state.me).toBe(ids.Bob);
  });

  it('lets Lobby co-players see each other\'s Profiles (FR-20)', async () => {
    const res = await app.request('/api/v1/players/ada?today=2026-11-16', jsonRequest('GET', undefined, cookies.Bob));
    expect(res.status).toBe(200);
    expect((await app.request('/api/v1/players/ada?today=2026-11-16', jsonRequest('GET', undefined, cookies.Dan))).status).toBe(403);
  });

  it('only the Host changes Quiz, Question count and time, and everyone sees it', async () => {
    expect(await bob.send(LOBBY_COMMANDS.settings, { questionCount: 5 })).toEqual({ ok: false, code: 'lobby.notHost' });
    for (const bad of [{ questionCount: 4 }, { questionCount: 21 }, { timeLimitS: 9 }, { timeLimitS: 31 }, { questionCount: 7.5 }]) {
      expect(await ada.send(LOBBY_COMMANDS.settings, bad)).toEqual({ ok: false, code: 'lobby.invalid' });
    }
    expect(await ada.send(LOBBY_COMMANDS.settings, { quizSlug: 'nope' })).toEqual({ ok: false, code: 'lobby.quizNotFound' });
    await ada.ok(LOBBY_COMMANDS.settings, { quizSlug: 'solar-system', questionCount: 5, timeLimitS: 30 });
    await until(() => expect(cyd.state.settings).toEqual({ quizSlug: 'solar-system', questionCount: 5, timeLimitS: 30 }));
    expect(bob.state.quiz.title.en).toBe('The Solar System');
  });

  it('only the Host removes a player, who cannot come back', async () => {
    expect(await bob.send(LOBBY_COMMANDS.kick, { userId: ids.Cyd })).toEqual({ ok: false, code: 'lobby.notHost' });
    expect(await ada.send(LOBBY_COMMANDS.kick, { userId: ids.Ada })).toEqual({ ok: false, code: 'lobby.unknownPlayer' });
    await ada.ok(LOBBY_COMMANDS.kick, { userId: ids.Cyd });
    await until(() => expect(cyd.removals).toEqual([{ reason: 'kicked' }]));
    await until(() => expect(names(bob)).toEqual(['Ada', 'Bob']));
    expect(await cyd.send(LOBBY_COMMANDS.settings, { questionCount: 6 })).toEqual({ ok: false, code: 'lobby.notInLobby' });
    expect(await cyd.send(LOBBY_COMMANDS.join, { code })).toEqual({ ok: false, code: 'lobby.kicked' });
  });

  it('invites a Friend with a notification that opens the Lobby (FR-29)', async () => {
    await expectProblem(await app.request(`/api/v1/lobbies/${code}/invites`, jsonRequest('POST', { userId: ids.Dan }, cookies.Dan)), 403, 'lobby.notInLobby');
    await expectProblem(await app.request(`/api/v1/lobbies/${code}/invites`, jsonRequest('POST', { userId: ids.Dan }, cookies.Bob)), 404, 'social.notFriend');
    await expectProblem(await app.request('/api/v1/lobbies/ZZZZZZ/invites', jsonRequest('POST', { userId: ids.Dan }, cookies.Bob)), 404, 'lobby.notFound');
    expect((await app.request('/api/v1/friends/requests', jsonRequest('POST', { username: 'dan' }, cookies.Bob))).status).toBe(201);
    expect((await app.request('/api/v1/friends/requests', jsonRequest('POST', { username: 'bob' }, cookies.Dan))).status).toBe(200);
    expect((await app.request(`/api/v1/lobbies/${code}/invites`, jsonRequest('POST', { userId: ids.Dan }, cookies.Bob))).status).toBe(204);
    const list = NotificationsResponseSchema.parse(await (await app.request('/api/v1/notifications', jsonRequest('GET', undefined, cookies.Dan))).json());
    expect(list.notifications.find((item) => item.kind === 'lobbyInvite')).toMatchObject({ actor: { username: 'Bob' }, code, quizTitle: { en: 'The Solar System' } });
  });

  it('a disconnected player shows as offline, then leaves the waiting room after the grace period', async () => {
    const dan = await client('Dan');
    await dan.ok(LOBBY_COMMANDS.join, { code });
    await until(() => expect(names(ada)).toEqual(['Ada', 'Bob', 'Dan']));
    dan.close();
    await until(() => expect(ada.state.players.find((player) => player.username === 'Dan')?.connected).toBe(false));
    await clock.advance(DISCONNECT_GRACE_MS - 1);
    expect(names(ada)).toEqual(['Ada', 'Bob', 'Dan']);
    await clock.advance(1);
    await until(() => expect(names(ada)).toEqual(['Ada', 'Bob']));
  });

  it('when the Host leaves, the longest-present player becomes Host', async () => {
    await ada.ok(LOBBY_COMMANDS.leave);
    await until(() => expect(bob.state.hostId).toBe(ids.Bob));
    expect(names(bob)).toEqual(['Bob']);
    await bob.ok(LOBBY_COMMANDS.settings, { questionCount: 6 });
  });
});

describe('a game over sockets (Story 5.2, FR-31, FR-32, AD-7)', () => {
  it('sends Questions without the answer, scores by server time and reveals to all', async () => {
    const code = await createLobby('Cyd', 'solar-system');
    const cyd = await client('Cyd');
    const dan = await client('Dan');
    await cyd.ok(LOBBY_COMMANDS.join, { code });
    await dan.ok(LOBBY_COMMANDS.join, { code });
    await cyd.ok(LOBBY_COMMANDS.settings, { questionCount: 5, timeLimitS: 10 });
    expect(await dan.send(LOBBY_COMMANDS.start)).toEqual({ ok: false, code: 'lobby.notHost' });
    await cyd.ok(LOBBY_COMMANDS.start);
    await until(() => expect(dan.state.phase).toBe('question'));
    const rows = await db.select().from(question).where(eq(question.quizSlug, 'solar-system'));
    const answerOf = (text: string) => rows.find((row) => row.content.text.en === text)!.correctIndex;

    const shown = dan.state.question!;
    expect(shown).toMatchObject({ index: 0, total: 5, limitMs: 10_000 });
    expect(JSON.stringify(dan.states)).not.toMatch(/correctIndex|answerTitle/);
    const right = answerOf(shown.text.en);
    await clock.advance(1_000);
    await cyd.ok(LOBBY_COMMANDS.answer, { index: 0, selectedIndex: right });
    expect(await cyd.send(LOBBY_COMMANDS.answer, { index: 0, selectedIndex: (right + 1) % 4 })).toEqual({ ok: false, code: 'lobby.alreadyAnswered' });
    expect(await dan.send(LOBBY_COMMANDS.answer, { index: 0, selectedIndex: 9 })).toEqual({ ok: false, code: 'lobby.invalid' });
    await clock.advance(4_000);
    await dan.ok(LOBBY_COMMANDS.answer, { index: 0, selectedIndex: (right + 1) % 4 });
    await until(() => expect(dan.state.phase).toBe('reveal'));
    expect(dan.state.reveal).toMatchObject({ correctIndex: right });
    expect(dan.state.leaderboard).toEqual([
      { userId: ids.Cyd, score: 950, correct: 1, rank: 1 },
      { userId: ids.Dan, score: 0, correct: 0, rank: 2 },
    ]);
    await clock.advance(REVEAL_MS);
    await until(() => expect(cyd.state.question?.index).toBe(1));
    cyd.close();
    dan.close();
  });
});

describe('Lobby actor limits (unit, AD-8)', () => {
  const card = (n: number): PlayerCard => ({ id: `p${n}`, username: `P${n}`, avatar: null, title: null });
  function actor(clock = new ManualClock()) {
    const closed: string[] = [];
    const env: LobbyEnv = {
      clock,
      playerCard: async (id) => card(Number(id.slice(1))),
      quiz: async (slug) => ({ slug, title: { en: slug } }),
      questions: async () => [],
      publish: () => {},
      removed: () => {},
      closed: () => closed.push('closed'),
    };
    return { lobby: new LobbyActor('ABCDEF', card(0), { slug: 'q', title: { en: 'Q' } }, { questionCount: 10, timeLimitS: 20 }, env), closed, clock };
  }

  it('holds at most 20 players', async () => {
    const { lobby } = actor();
    for (let i = 0; i < 20; i += 1) expect(await lobby.join(`p${i}`, `s${i}`)).toEqual({ ok: true });
    expect(await lobby.join('p20', 's20')).toEqual({ ok: false, code: 'lobby.full' });
    // A player already in it can still connect another tab.
    expect(await lobby.join('p3', 's3b')).toEqual({ ok: true });
  });

  it('closes when idle with nobody connected, and when the last player leaves', async () => {
    const first = actor();
    await first.lobby.join('p0', 's0');
    await first.lobby.disconnect('p0', 's0');
    await first.clock.advance(DISCONNECT_GRACE_MS);
    expect(first.closed).toEqual(['closed']);
    const second = actor();
    await second.clock.advance(IDLE_CLOSE_MS);
    await settle();
    expect(second.closed).toEqual(['closed']);
    expect(second.lobby.isClosed).toBe(true);
    expect(await second.lobby.join('p1', 's1')).toEqual({ ok: false, code: 'lobby.notFound' });
  });

  it('processes commands strictly in order', async () => {
    const { lobby } = actor();
    const order: string[] = [];
    await Promise.all([
      lobby.join('p0', 's0').then(() => order.push('join')),
      lobby.updateSettings('p0', { questionCount: 5 }).then(() => order.push('settings')),
      lobby.kick('p0', 'p9').then(() => order.push('kick')),
    ]);
    expect(order).toEqual(['join', 'settings', 'kick']);
  });
});

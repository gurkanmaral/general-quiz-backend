import { describe, expect, it } from 'vitest';
import { LobbyStateSchema, lobbyPoints } from '../src/contracts';
import { REVEAL_MS } from '../src/modules/lobbies';
import { settle } from './clock';
import { testLobby } from './lobbyActor';

/** Three connected players (p0 Host) in a started game of 3 Questions. Question n's answer is n % 4. */
async function started(questions = 3) {
  const setup = testLobby({ questions });
  for (const id of ['p0', 'p1', 'p2']) expect(await setup.lobby.join(id, `s-${id}`)).toEqual({ ok: true });
  expect(await setup.lobby.start('p0')).toEqual({ ok: true });
  return setup;
}

describe('speed score (FR-32)', () => {
  it('is 1000 at once, 500 at the deadline, linear between, 0 when wrong', () => {
    expect(lobbyPoints(true, 0, 20_000)).toBe(1000);
    expect(lobbyPoints(true, 20_000, 20_000)).toBe(500);
    expect(lobbyPoints(true, 2_000, 20_000)).toBe(950);
    expect(lobbyPoints(true, 7_777, 20_000)).toBe(806);
    expect(lobbyPoints(false, 0, 20_000)).toBe(0);
  });
});

describe('synchronized Questions (Story 5.2, FR-31, AD-7)', () => {
  it('only the Host starts, and only from the waiting room', async () => {
    const { lobby } = testLobby();
    await lobby.join('p0', 's0');
    await lobby.join('p1', 's1');
    expect(await lobby.start('p1')).toEqual({ ok: false, code: 'lobby.notHost' });
    expect(await lobby.start('p9')).toEqual({ ok: false, code: 'lobby.notInLobby' });
    expect(await lobby.start('p0')).toEqual({ ok: true });
    expect(await lobby.start('p0')).toEqual({ ok: false, code: 'lobby.wrongPhase' });
    expect(await lobby.join('p5', 's5')).toEqual({ ok: false, code: 'lobby.inProgress' });
  });

  it('refuses to start a Quiz without Questions', async () => {
    const { lobby } = testLobby({ questions: 0 });
    await lobby.join('p0', 's0');
    expect(await lobby.start('p0')).toEqual({ ok: false, code: 'lobby.noQuestions' });
  });

  it('sends every player the same Question at the same moment, with the server deadline and no answer', async () => {
    const { last, clock } = await started();
    const views = ['p0', 'p1', 'p2'].map((id) => LobbyStateSchema.parse(last(id)));
    for (const view of views) {
      expect(view.phase).toBe('question');
      expect(view.question).toMatchObject({ index: 0, total: 3, text: { en: 'Question 1?' }, limitMs: 20_000, myAnswer: null });
      expect(view.question!.startedAt).toBe(new Date(clock.now()).toISOString());
      expect(view.question!.deadline).toBe(new Date(clock.now() + 20_000).toISOString());
      expect(view.reveal).toBeNull();
      expect(JSON.stringify(view)).not.toMatch(/correctIndex|answerTitle|Story 1/);
    }
  });

  it('the first answer locks; others only see that a player answered', async () => {
    const { lobby, last, clock } = await started();
    await clock.advance(2_000);
    expect(await lobby.answer('p1', 0, 1)).toEqual({ ok: true });
    expect(await lobby.answer('p1', 0, 2)).toEqual({ ok: false, code: 'lobby.alreadyAnswered' });
    expect(last('p1').question!.myAnswer).toBe(1);
    expect(last('p0').question!.myAnswer).toBeNull();
    expect(last('p0').players.find((player) => player.id === 'p1')!.answered).toBe(true);
    expect(JSON.stringify(last('p0'))).not.toMatch(/"selectedIndex"/);
    expect(await lobby.answer('p2', 5, 1)).toEqual({ ok: false, code: 'lobby.wrongPhase' });
    expect(await lobby.answer('p9', 0, 1)).toEqual({ ok: false, code: 'lobby.notInLobby' });
  });
});

describe('scoring, reveal and leaderboard (Story 5.2, FR-32)', () => {
  it('ends when everyone answered: scores by server receive time, reveals the answer and a leaderboard', async () => {
    const { lobby, last, clock } = await started();
    await clock.advance(2_000);
    await lobby.answer('p1', 0, 1); // correct after 2 s → 950
    await clock.advance(3_000);
    await lobby.answer('p0', 0, 3); // wrong → 0
    expect(last('p0').phase).toBe('question');
    await clock.advance(5_000);
    await lobby.answer('p2', 0, 1); // correct after 10 s → 750; everyone answered
    const view = last('p2');
    expect(view.phase).toBe('reveal');
    expect(view.reveal).toMatchObject({ index: 0, correctIndex: 1, answerTitle: { en: 'Answer 1' }, summary: { en: 'Story 1' } });
    expect(view.reveal!.results).toEqual([
      { userId: 'p0', selectedIndex: 3, correct: false, points: 0 },
      { userId: 'p1', selectedIndex: 1, correct: true, points: 950 },
      { userId: 'p2', selectedIndex: 1, correct: true, points: 750 },
    ]);
    expect(view.leaderboard).toEqual([
      { userId: 'p1', score: 950, correct: 1, rank: 1 },
      { userId: 'p2', score: 750, correct: 1, rank: 2 },
      { userId: 'p0', score: 0, correct: 0, rank: 3 },
    ]);
    expect(view.players.map((player) => player.score)).toEqual([0, 950, 750]);
    // Every player sees the same reveal.
    expect(last('p0').reveal).toEqual(view.reveal);
  });

  it('ends at the deadline: missing answers score 0, an answer right at the deadline scores 500, later ones are refused', async () => {
    const { lobby, last, clock } = await started();
    await clock.advance(19_999);
    clock.time += 1; // received exactly at the deadline, before the timer has run
    expect(await lobby.answer('p0', 0, 1)).toEqual({ ok: true });
    await clock.advance(0);
    const view = last('p1');
    expect(view.phase).toBe('reveal');
    expect(view.reveal!.results.map((result) => result.points)).toEqual([500, 0, 0]);
    expect(await lobby.answer('p1', 0, 1)).toEqual({ ok: false, code: 'lobby.tooLate' });
  });

  it('starts the next Question after the reveal, and the podium after the last one', async () => {
    const { lobby, last, clock } = await started(2);
    await clock.advance(20_000);
    expect(last('p0').reveal!.nextAt).toBe(new Date(clock.now() + REVEAL_MS).toISOString());
    await clock.advance(REVEAL_MS);
    expect(last('p0')).toMatchObject({ phase: 'question', question: { index: 1, text: { en: 'Question 2?' } } });
    for (const id of ['p0', 'p1', 'p2']) await lobby.answer(id, 1, 2);
    expect(last('p0').phase).toBe('reveal');
    await clock.advance(REVEAL_MS);
    expect(last('p0').phase).toBe('podium');
    expect(last('p0').question).toBeNull();
  });

  it('measures speed when the answer arrives, not when the queue gets to it', async () => {
    const { lobby, last, clock } = await started();
    await clock.advance(4_000);
    const pending = lobby.answer('p1', 0, 1);
    clock.time += 6_000; // the queue runs later; the receive time was already taken
    await pending;
    for (const id of ['p0', 'p2']) await lobby.answer(id, 0, 0);
    expect(last('p1').reveal!.results.find((result) => result.userId === 'p1')!.points).toBe(lobbyPoints(true, 4_000, 20_000));
  });

  it('is deterministic whatever order simultaneous and late answers arrive in', async () => {
    type Arrival = { id: string; at: number; option: number };
    const arrivals: Arrival[] = [
      { id: 'p0', at: 1_000, option: 1 },
      { id: 'p1', at: 1_000, option: 1 },
      { id: 'p2', at: 25_000, option: 1 },
    ];
    async function play(order: Arrival[]) {
      const { lobby, last, clock } = await started();
      const start = clock.now();
      const acks = [];
      for (const arrival of order) {
        clock.time = start + arrival.at;
        acks.push(lobby.answer(arrival.id, 0, arrival.option));
      }
      clock.time = start;
      await clock.advance(25_000);
      await Promise.all(acks);
      await settle();
      return { reveal: last('p0').reveal!.results, board: last('p0').leaderboard };
    }
    const forward = await play(arrivals);
    const backward = await play([...arrivals].reverse());
    expect(backward).toEqual(forward);
    expect(forward.board).toEqual([
      { userId: 'p0', score: 975, correct: 1, rank: 1 },
      { userId: 'p1', score: 975, correct: 1, rank: 1 },
      { userId: 'p2', score: 0, correct: 0, rank: 3 },
    ]);
  });

  it("doesn't wait for a player who dropped mid-Question", async () => {
    const { lobby, last } = await started();
    await lobby.answer('p0', 0, 1);
    await lobby.answer('p1', 0, 1);
    expect(last('p0').phase).toBe('question');
    await lobby.disconnect('p2', 's-p2');
    expect(last('p0').phase).toBe('reveal');
    expect(last('p0').players.find((player) => player.id === 'p2')).toMatchObject({ connected: false });
  });

  it('a player who leaves mid-game drops out of the game', async () => {
    const { lobby, last } = await started();
    await lobby.answer('p0', 0, 1);
    await lobby.answer('p1', 0, 1);
    expect(await lobby.leave('p2')).toEqual({ ok: true });
    expect(last('p0').phase).toBe('reveal');
    expect(last('p0').leaderboard.map((row) => row.userId)).toEqual(['p0', 'p1']);
  });
});

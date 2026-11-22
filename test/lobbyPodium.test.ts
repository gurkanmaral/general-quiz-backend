import { describe, expect, it, vi } from 'vitest';
import type { UnlockedAward } from '../src/contracts';
import { DISCONNECT_GRACE_MS, REVEAL_MS, type GameResult } from '../src/modules/lobbies';
import { testLobby } from './lobbyActor';

const FRODO: UnlockedAward = { slug: 'lotr-frodo', kind: 'title', quizSlug: 'quiz', name: { en: 'Frodo' }, description: { en: 'x' }, icon: '💍', rarity: { percent: null, label: 'New' } };

/** Question n's correct option is n % 4 (see testQuestion); Questions are numbered from 1. */
const right = (index: number) => (index + 1) % 4;

async function setup(questions: number, recordGame?: (result: GameResult) => Promise<Map<string, UnlockedAward[]>>, onError = vi.fn()) {
  const lobby = testLobby({ questions, extra: recordGame ? { recordGame, onError } : { onError } });
  for (const id of ['p0', 'p1', 'p2']) await lobby.lobby.join(id, `s-${id}`);
  await lobby.lobby.start('p0');
  return { ...lobby, onError };
}

describe('rejoin after a disconnect (Story 5.3, FR-33)', () => {
  it('a dropped player keeps their place, rejoins at the current Question, and missed ones score 0', async () => {
    const { lobby, last, clock } = await setup(3);
    await lobby.answer('p2', 0, right(0));
    await lobby.disconnect('p2', 's-p2');
    for (const id of ['p0', 'p1']) await lobby.answer(id, 0, right(0));
    await clock.advance(REVEAL_MS);
    expect(last('p0').players.map((player) => [player.id, player.connected])).toEqual([
      ['p0', true],
      ['p1', true],
      ['p2', false],
    ]);
    for (const id of ['p0', 'p1']) await lobby.answer(id, 1, right(1));
    await clock.advance(REVEAL_MS);
    expect(last('p0').question!.index).toBe(2);

    expect(await lobby.join('p2', 's-p2-again')).toEqual({ ok: true });
    const back = last('p2');
    expect(back).toMatchObject({ phase: 'question', question: { index: 2, myAnswer: null } });
    expect(back.players.find((player) => player.id === 'p2')).toMatchObject({ connected: true, score: 1000 });
    await lobby.answer('p2', 2, right(2));
    for (const id of ['p0', 'p1']) await lobby.answer(id, 2, (right(2) + 1) % 4);
    const results = last('p2').reveal!.results.find((result) => result.userId === 'p2');
    expect(results).toMatchObject({ correct: true });
    // Q1 at once (1000), Q2 missed (0), Q3 at once (1000).
    expect(last('p2').leaderboard.find((row) => row.userId === 'p2')).toMatchObject({ score: 2000, correct: 2 });
  });

  it('a Host who stays away mid-game passes Host to the longest-present connected player', async () => {
    const { lobby, last, clock } = await setup(3);
    await lobby.disconnect('p0', 's-p0');
    await clock.advance(DISCONNECT_GRACE_MS);
    expect(last('p1').hostId).toBe('p1');
    // Long gone, but a running game keeps their place for a rejoin.
    expect(last('p1').players.map((player) => player.id)).toEqual(['p0', 'p1', 'p2']);
    expect(await lobby.join('p0', 's-p0-again')).toEqual({ ok: true });
    expect(last('p0').phase).not.toBe('waiting');
  });
});

describe('podium and progress (Story 5.3, FR-34)', () => {
  async function playToEnd(questions = 2, recordGame?: (result: GameResult) => Promise<Map<string, UnlockedAward[]>>, onError = vi.fn()) {
    const game = await setup(questions, recordGame, onError);
    for (let index = 0; index < questions; index += 1) {
      await game.lobby.answer('p1', index, right(index));
      await game.lobby.answer('p0', index, (right(index) + 1) % 4);
      if (index === 0) await game.lobby.answer('p2', index, right(index));
      // Everyone answered the first Question; later ones wait for p2 until the deadline.
      await game.clock.advance(index === 0 ? REVEAL_MS : 20_000 + REVEAL_MS);
    }
    return game;
  }

  it('records the game through progress and shows everyone the podium, ranking and unlocks', async () => {
    const recordGame = vi.fn(async (_result: GameResult) => new Map([['p1', [FRODO]]]));
    const { last } = await playToEnd(2, recordGame);
    expect(recordGame).toHaveBeenCalledTimes(1);
    const result = recordGame.mock.calls[0]![0];
    expect(result).toMatchObject({ code: 'ABCDEF', quizSlug: 'quiz', questionCount: 2 });
    expect(Object.fromEntries(result.outcomes)).toEqual({
      p0: [
        { questionSlug: 'q1', correct: false },
        { questionSlug: 'q2', correct: false },
      ],
      p1: [
        { questionSlug: 'q1', correct: true },
        { questionSlug: 'q2', correct: true },
      ],
      // Missed Questions are not answers.
      p2: [{ questionSlug: 'q1', correct: true }],
    });
    for (const id of ['p0', 'p1', 'p2']) {
      const view = last(id);
      expect(view.phase).toBe('podium');
      expect(view.podium!.ranking.map((row) => [row.rank, row.player.username, row.score, row.unlocks.map((award) => award.slug)])).toEqual([
        [1, 'P1', 2000, ['lotr-frodo']],
        [2, 'P2', 1000, []],
        [3, 'P0', 0, []],
      ]);
    }
  });

  it('still shows the podium when recording fails', async () => {
    const onError = vi.fn();
    const { last } = await playToEnd(1, async () => {
      throw new Error('db down');
    }, onError);
    expect(last('p0').phase).toBe('podium');
    expect(last('p0').podium!.ranking).toHaveLength(3);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('Play again keeps the Lobby and its players; only the Host can do it', async () => {
    const { lobby, last } = await playToEnd(1);
    expect(await lobby.playAgain('p1')).toEqual({ ok: false, code: 'lobby.notHost' });
    expect(await lobby.playAgain('p0')).toEqual({ ok: true });
    const view = last('p2');
    expect(view).toMatchObject({ phase: 'waiting', podium: null, leaderboard: [], question: null });
    expect(view.players.map((player) => [player.id, player.score])).toEqual([
      ['p0', 0],
      ['p1', 0],
      ['p2', 0],
    ]);
    expect(await lobby.playAgain('p0')).toEqual({ ok: false, code: 'lobby.wrongPhase' });
    expect(await lobby.start('p0')).toEqual({ ok: true });
    expect(last('p1').question!.index).toBe(0);
  });

  it('players who never came back leave the podium after the grace period', async () => {
    const game = await setup(1);
    await game.lobby.disconnect('p2', 's-p2');
    await game.clock.advance(20_000 + REVEAL_MS);
    expect(game.last('p0').phase).toBe('podium');
    expect(game.last('p0').players.map((player) => player.id)).toEqual(['p0', 'p1', 'p2']);
    await game.clock.advance(DISCONNECT_GRACE_MS);
    expect(game.last('p0').players.map((player) => player.id)).toEqual(['p0', 'p1']);
    // The podium keeps their result.
    expect(game.last('p0').podium!.ranking.map((row) => row.userId)).toContain('p2');
  });
});

import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbExecutor } from '../../db/client';
import { uuidv7 } from '../../db/ids';
import { lobbyGame, lobbyGamePlayer } from './schema';

export type FinishedLobbyGame = {
  code: string;
  quizSlug: string;
  questionCount: number;
  endedAt: Date;
  players: readonly { userId: string; score: number; correct: number; rank: number }[];
};

/** Stores a finished Lobby Game's ranking (inside the transaction that updates Quiz Records). */
export async function saveLobbyGame(db: DbExecutor, game: FinishedLobbyGame): Promise<string> {
  const id = uuidv7(game.endedAt.getTime());
  await db.insert(lobbyGame).values({ id, code: game.code, quizSlug: game.quizSlug, questionCount: game.questionCount, endedAt: game.endedAt });
  if (game.players.length) await db.insert(lobbyGamePlayer).values(game.players.map((player) => ({ gameId: id, ...player })));
  return id;
}

/** True when both players were in one finished Lobby Game (Lobby co-players, FR-20). */
export async function playedTogether(db: DbExecutor, a: string, b: string): Promise<boolean> {
  const other = alias(lobbyGamePlayer, 'other');
  const [row] = await db
    .select({ gameId: lobbyGamePlayer.gameId })
    .from(lobbyGamePlayer)
    .innerJoin(other, and(eq(other.gameId, lobbyGamePlayer.gameId), eq(other.userId, b)))
    .where(eq(lobbyGamePlayer.userId, a))
    .limit(1);
  return Boolean(row);
}

/** Accounts that finished a Lobby Game (a Ranked Account source for Rarity, FR-19). */
export async function lobbyPlayerIds(db: DbExecutor): Promise<string[]> {
  const rows = await db.selectDistinct({ userId: lobbyGamePlayer.userId }).from(lobbyGamePlayer);
  return rows.map((row) => row.userId);
}

/** Account deletion (FR-4): the player's Lobby results. */
export async function deleteLobbiesUserData(db: DbExecutor, userId: string): Promise<void> {
  await db.delete(lobbyGamePlayer).where(eq(lobbyGamePlayer.userId, userId));
}


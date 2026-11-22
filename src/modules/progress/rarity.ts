import { inArray, sql } from 'drizzle-orm';
import { toRarity, type Rarity } from '../../contracts';
import type { DbExecutor } from '../../db/client';
import type { Logger } from '../../logger';
import { quizAwards } from '../quizzes';
import { rarity, userAward } from './schema';

/**
 * Ids of accounts that finished at least one game of some kind (a Daily, a Solo Game, later a Lobby
 * Game). Each owning module supplies one; their union is the Ranked Accounts (glossary, FR-19).
 */
export type RankedAccountSource = (db: DbExecutor) => Promise<readonly string[]>;

export type RarityReport = { rankedAccounts: number; items: number };

/**
 * Recomputes every Badge's and Title's Rarity: the percentage of Ranked Accounts holding it (AD-11).
 * Deleted accounts drop out of both counts because their rows are gone (FR-4).
 */
export async function computeRarity(db: DbExecutor, sources: readonly RankedAccountSource[], now = new Date()): Promise<RarityReport> {
  const ranked = new Set<string>();
  for (const source of sources) for (const id of await source(db)) ranked.add(id);
  const ids = [...ranked];
  const awards = await quizAwards(db, undefined, true);
  const holders = new Map<string, number>();
  if (ids.length) {
    const rows = await db
      .select({ slug: userAward.awardSlug, holders: sql<number>`count(*)`.mapWith(Number) })
      .from(userAward)
      .where(inArray(userAward.userId, ids))
      .groupBy(userAward.awardSlug);
    for (const row of rows) holders.set(row.slug, row.holders);
  }
  const values = awards.map((entry) => {
    const count = holders.get(entry.slug) ?? 0;
    // Two decimals are plenty for display and keep stored values exact.
    const percent = ids.length ? Math.round((count / ids.length) * 10_000) / 100 : 0;
    return { awardSlug: entry.slug, holders: count, rankedAccounts: ids.length, percent, computedAt: now };
  });
  if (values.length) {
    await db
      .insert(rarity)
      .values(values)
      .onConflictDoUpdate({
        target: rarity.awardSlug,
        set: {
          holders: sql`excluded.holders`,
          rankedAccounts: sql`excluded.ranked_accounts`,
          percent: sql`excluded.percent`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }
  return { rankedAccounts: ids.length, items: values.length };
}

/** The stored Rarity of each item ("New" when not computed yet). Never aggregates live (AD-11). */
export async function rarityOf(db: DbExecutor, awardSlugs: readonly string[]): Promise<Map<string, Rarity>> {
  const result = new Map(awardSlugs.map((slug) => [slug, toRarity(null)]));
  if (awardSlugs.length === 0) return result;
  const rows = await db.select().from(rarity).where(inArray(rarity.awardSlug, [...awardSlugs]));
  for (const row of rows) result.set(row.awardSlug, toRarity(row.percent));
  return result;
}

export const RARITY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Runs `run` now and then every `intervalMs` (default 24 h); failures are logged, never thrown. */
export function startRarityJob(run: () => Promise<RarityReport>, logger: Logger, intervalMs = RARITY_INTERVAL_MS): { stop: () => void; ready: Promise<void> } {
  const tick = () =>
    run().then(
      (report) => logger.info(report, 'rarity recomputed'),
      (error: unknown) => logger.error({ err: error }, 'rarity job failed'),
    );
  const ready = tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), ready };
}

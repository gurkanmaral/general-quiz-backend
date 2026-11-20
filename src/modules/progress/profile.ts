import { and, asc, eq } from 'drizzle-orm';
import type { EquippedTitle, ProfileAward, ProfileQuiz } from '@general-quiz/contracts';
import type { DbExecutor } from '../../db/client';
import { awardDefinitions, quizAwards, quizTitles, type AwardDefinition } from '../quizzes';
import { rarityOf } from './rarity';
import { equippedTitle, userAward } from './schema';
import { describeUnlockRule } from './unlocks';

function toEquipped(definition: AwardDefinition): EquippedTitle {
  return { slug: definition.slug, name: definition.name, icon: definition.icon };
}

/** The Title a player shows next to their name, or null (FR-18). */
export async function getEquippedTitle(db: DbExecutor, userId: string): Promise<EquippedTitle | null> {
  const [row] = await db.select().from(equippedTitle).where(eq(equippedTitle.userId, userId)).limit(1);
  if (!row) return null;
  const definition = (await awardDefinitions(db, [row.awardSlug])).get(row.awardSlug);
  return definition ? toEquipped(definition) : null;
}

export type EquipResult = { ok: true; title: EquippedTitle | null } | { ok: false };

/** Equips one earned Title, or none with `null` (FR-18). Badges and unearned Titles are refused. */
export async function equipTitle(db: DbExecutor, userId: string, slug: string | null): Promise<EquipResult> {
  if (slug === null) {
    await db.delete(equippedTitle).where(eq(equippedTitle.userId, userId));
    return { ok: true, title: null };
  }
  const [earned] = await db
    .select()
    .from(userAward)
    .where(and(eq(userAward.userId, userId), eq(userAward.awardSlug, slug)))
    .limit(1);
  const definition = earned ? (await awardDefinitions(db, [slug])).get(slug) : undefined;
  if (!definition || definition.kind !== 'title') return { ok: false };
  await db
    .insert(equippedTitle)
    .values({ userId, awardSlug: slug })
    .onConflictDoUpdate({ target: equippedTitle.userId, set: { awardSlug: slug, updatedAt: new Date() } });
  return { ok: true, title: toEquipped(definition) };
}

/**
 * A player's Badges and Titles grouped by Quiz, with Rarity (FR-20). On one's own Profile every
 * published item is listed, unearned ones with how to earn them; for others, only earned items.
 * Earned items stay even after they are withdrawn from content.
 */
export async function profileAwards(db: DbExecutor, userId: string, own: boolean): Promise<ProfileQuiz[]> {
  const earnedRows = await db.select().from(userAward).where(eq(userAward.userId, userId)).orderBy(asc(userAward.earnedAt));
  const earnedAt = new Map(earnedRows.map((row) => [row.awardSlug, row.earnedAt]));
  const earnedDefinitions = await awardDefinitions(db, [...earnedAt.keys()]);
  const definitions = own ? await quizAwards(db) : [];
  const bySlug = new Map<string, AwardDefinition>(definitions.map((entry) => [entry.slug, entry]));
  for (const [slug, entry] of earnedDefinitions) if (!bySlug.has(slug)) bySlug.set(slug, entry);

  const items = [...bySlug.values()].sort((a, b) => a.quizSlug.localeCompare(b.quizSlug) || (a.kind === b.kind ? 0 : a.kind === 'badge' ? -1 : 1));
  const [rarities, titles] = await Promise.all([
    rarityOf(db, items.map((entry) => entry.slug)),
    quizTitles(db, [...new Set(items.map((entry) => entry.quizSlug))]),
  ]);

  const groups = new Map<string, ProfileQuiz>();
  for (const entry of items) {
    const at = earnedAt.get(entry.slug);
    const award: ProfileAward = {
      slug: entry.slug,
      kind: entry.kind,
      quizSlug: entry.quizSlug,
      name: entry.name,
      description: entry.description,
      icon: entry.icon,
      rarity: rarities.get(entry.slug)!,
      earned: Boolean(at),
      earnedAt: at ? at.toISOString() : null,
      howToEarn: !at && own ? describeUnlockRule(entry.unlock) : null,
    };
    const group = groups.get(entry.quizSlug) ?? { slug: entry.quizSlug, title: titles.get(entry.quizSlug) ?? { en: entry.quizSlug }, awards: [] };
    group.awards.push(award);
    groups.set(entry.quizSlug, group);
  }
  return [...groups.values()].sort((a, b) => a.title.en.localeCompare(b.title.en));
}

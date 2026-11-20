import { UsernameSchema } from '@general-quiz/contracts';

/**
 * Small offensive-word and impersonation blocklist (NFR-8). Matched as a substring of the
 * lower-cased Username with underscores and common digit swaps removed, so `F_u_c_k` or
 * `5h1t` are caught too. Deliberately short: Story 6.3 owns broader moderation.
 */
const BLOCKED_WORDS = [
  'fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'pussy', 'penis', 'vagina',
  'nigger', 'nigga', 'faggot', 'retard', 'hitler',
  'orospu', 'sikis', 'sikerim', 'amcik', 'yarrak', 'pezevenk', 'gavat',
] as const;

/**
 * Words that also occur inside harmless names (grape, peacock, Nazim): blocked only as a whole
 * name or a whole `_`/digit-separated part of it.
 */
const BLOCKED_PARTS = ['rape', 'dick', 'cock', 'porn', 'nazi', 'ibne', 'sex', 'anal'] as const;

/** Names nobody may take because they look official. Compared to the whole normalized name. */
const RESERVED_NAMES = ['admin', 'administrator', 'kno', 'knoteam', 'moderator', 'mod', 'support', 'root', 'system', 'staff', 'official'] as const;

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };

/** The unique form of a Username: lower-cased. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function skeleton(username: string): string {
  return normalizeUsername(username)
    .replace(/_/g, '')
    .replace(/[0-9]/g, (digit) => LEET[digit] ?? digit);
}

export function isUsernameAllowed(username: string): boolean {
  const plain = skeleton(username);
  const bare = normalizeUsername(username).replace(/_/g, '');
  if ((RESERVED_NAMES as readonly string[]).includes(bare) || (RESERVED_NAMES as readonly string[]).includes(plain)) return false;
  if (BLOCKED_WORDS.some((word) => plain.includes(word) || bare.includes(word))) return false;
  const parts = normalizeUsername(username).split(/[_0-9]+/).filter(Boolean);
  return !parts.some((part) => (BLOCKED_PARTS as readonly string[]).includes(part)) && !(BLOCKED_PARTS as readonly string[]).includes(plain);
}

/** Format (3–20 `[A-Za-z0-9_]`) and blocklist; used by the profile route and Better Auth's username plugin. */
export function isValidUsername(username: string): boolean {
  return UsernameSchema.safeParse(username).success && isUsernameAllowed(username);
}

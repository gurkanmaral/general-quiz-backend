import { COUNTRIES } from './countries';

/**
 * Regions (FR-8): the five UN M49 continents, plus "all". Every UN member maps
 * to exactly one continent (e.g. Cyprus and Türkiye → Asia, Russia → Europe).
 */

export const CONTINENTS = ['africa', 'americas', 'asia', 'europe', 'oceania'] as const;
export type Continent = (typeof CONTINENTS)[number];

export const REGIONS = ['all', ...CONTINENTS] as const;
export type Region = (typeof REGIONS)[number];

export function isRegion(value: unknown): value is Region {
  return typeof value === 'string' && (REGIONS as readonly string[]).includes(value);
}

const MEMBERS: Readonly<Record<Continent, readonly string[]>> = {
  africa: [
    'dz', 'ao', 'bj', 'bw', 'bf', 'bi', 'cv', 'cm', 'cf', 'td', 'km', 'cg', 'cd', 'ci', 'dj', 'eg', 'gq', 'er',
    'sz', 'et', 'ga', 'gm', 'gh', 'gn', 'gw', 'ke', 'ls', 'lr', 'ly', 'mg', 'mw', 'ml', 'mr', 'mu', 'ma', 'mz',
    'na', 'ne', 'ng', 'rw', 'st', 'sn', 'sc', 'sl', 'so', 'za', 'ss', 'sd', 'tz', 'tg', 'tn', 'ug', 'zm', 'zw',
  ],
  americas: [
    'ag', 'ar', 'bs', 'bb', 'bz', 'bo', 'br', 'ca', 'cl', 'co', 'cr', 'cu', 'dm', 'do', 'ec', 'sv', 'gd', 'gt',
    'gy', 'ht', 'hn', 'jm', 'mx', 'ni', 'pa', 'py', 'pe', 'kn', 'lc', 'vc', 'sr', 'tt', 'us', 'uy', 've',
  ],
  asia: [
    'af', 'am', 'az', 'bh', 'bd', 'bt', 'bn', 'kh', 'cn', 'cy', 'ge', 'in', 'id', 'ir', 'iq', 'il', 'jp', 'jo',
    'kz', 'kw', 'kg', 'la', 'lb', 'my', 'mv', 'mn', 'mm', 'np', 'kp', 'om', 'pk', 'ph', 'qa', 'sa', 'sg', 'kr',
    'lk', 'sy', 'tj', 'th', 'tl', 'tm', 'tr', 'ae', 'uz', 'vn', 'ye',
  ],
  europe: [
    'al', 'ad', 'at', 'by', 'be', 'ba', 'bg', 'hr', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu', 'is', 'ie',
    'it', 'lv', 'li', 'lt', 'lu', 'mt', 'md', 'mc', 'me', 'nl', 'mk', 'no', 'pl', 'pt', 'ro', 'ru', 'sm', 'rs',
    'sk', 'si', 'es', 'se', 'ch', 'ua', 'gb',
  ],
  oceania: ['au', 'fj', 'ki', 'mh', 'fm', 'nr', 'nz', 'pw', 'pg', 'ws', 'sb', 'to', 'tv', 'vu'],
};

const CONTINENT_OF: ReadonlyMap<string, Continent> = new Map(
  CONTINENTS.flatMap((continent) => MEMBERS[continent].map((code) => [code, continent] as const)),
);

/** The UN M49 continent of a country, or undefined for an unknown code. */
export function continentOf(code: string): Continent | undefined {
  return CONTINENT_OF.get(code.toLowerCase());
}

/** The country codes of a Region, in `COUNTRIES` order. */
export function poolFor(region: Region): string[] {
  return COUNTRIES.map((c) => c.code).filter((code) => region === 'all' || continentOf(code) === region);
}

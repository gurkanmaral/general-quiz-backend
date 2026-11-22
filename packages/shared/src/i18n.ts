import countries from 'i18n-iso-countries';
import trCountries from 'i18n-iso-countries/langs/tr.json';
import { getCountry } from './countries';

/** Locales the app ships with. English is the fallback. */
export const SUPPORTED_LOCALES = ['en', 'tr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Pick the first supported Locale from a list of preferred language tags
 * (e.g. `navigator.languages` or expo-localization), matching on the primary
 * subtag case-insensitively. Falls back to English.
 */
export function detectLocale(preferred?: readonly string[] | null): Locale {
  for (const tag of preferred ?? []) {
    if (typeof tag !== 'string') continue;
    const primary = tag.trim().split(/[-_]/)[0]?.toLowerCase();
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

countries.registerLocale(trCountries);

/**
 * Turkish names where the package's default is ambiguous or differs from the
 * neutral, current short name used by the curated English list.
 */
const TR_OVERRIDES: Readonly<Record<string, string>> = {
  cg: 'Kongo Cumhuriyeti',
  cd: 'Demokratik Kongo Cumhuriyeti',
  cv: 'Yeşil Burun Adaları',
  cy: 'Kıbrıs',
  cz: 'Çekya',
  mm: 'Myanmar',
  sz: 'Esvatini',
  tl: 'Doğu Timor',
  us: 'Amerika Birleşik Devletleri',
};

/** Localized short name of a country by ISO alpha-2 code. Unknown codes return the uppercase code. */
export function countryName(code: string, locale: Locale | string): string {
  const lower = code.toLowerCase();
  const loc: Locale = isLocale(locale) ? locale : detectLocale([locale]);
  if (loc === 'tr') {
    const name = TR_OVERRIDES[lower] ?? countries.getName(lower.toUpperCase(), 'tr');
    if (name) return name;
  }
  return getCountry(lower)?.name ?? code.toUpperCase();
}

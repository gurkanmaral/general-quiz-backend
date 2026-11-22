import { describe, expect, it } from 'vitest';
import { COUNTRIES } from './countries';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, countryName, detectLocale, isLocale } from './i18n';
import en from './locales/en.json';
import tr from './locales/tr.json';

function keyPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

function leafValues(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj];
  if (obj === null || typeof obj !== 'object') return [];
  return Object.values(obj as Record<string, unknown>).flatMap(leafValues);
}

describe('detectLocale', () => {
  it('picks Turkish from a Turkish browser', () => {
    expect(detectLocale(['tr-TR', 'en'])).toBe('tr');
  });

  it('falls back to English for unsupported languages', () => {
    expect(detectLocale(['de-DE', 'fr'])).toBe('en');
  });

  it('matches the primary subtag case-insensitively', () => {
    expect(detectLocale(['TR'])).toBe('tr');
    expect(detectLocale(['en-GB'])).toBe('en');
    expect(detectLocale(['de', 'tr_TR'])).toBe('tr');
  });

  it('falls back to English when empty or missing', () => {
    expect(detectLocale([])).toBe('en');
    expect(detectLocale(undefined)).toBe('en');
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('takes the first supported match in order', () => {
    expect(detectLocale(['en-US', 'tr'])).toBe('en');
  });
});

describe('isLocale', () => {
  it('accepts only supported locales', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'tr']);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('tr')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale('TR')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('countryName', () => {
  it('returns Turkish names', () => {
    expect(countryName('de', 'tr')).toBe('Almanya');
    expect(countryName('ci', 'tr')).toBe('Fildişi Sahili');
    expect(countryName('DE', 'tr')).toBe('Almanya');
  });

  it('returns the curated English names', () => {
    expect(countryName('cg', 'en')).toBe('Republic of the Congo');
    expect(countryName('cd', 'en')).toBe('Democratic Republic of the Congo');
  });

  it('keeps the two Congos distinct in Turkish', () => {
    expect(countryName('cg', 'tr')).not.toBe(countryName('cd', 'tr'));
  });

  it('falls back to the uppercase code for unknown codes', () => {
    expect(countryName('xx', 'en')).toBe('XX');
    expect(countryName('xx', 'tr')).toBe('XX');
  });

  it.each(SUPPORTED_LOCALES)('has a unique, real name for all 193 countries in %s', (locale) => {
    expect(COUNTRIES).toHaveLength(193);
    const names = COUNTRIES.map((c) => countryName(c.code, locale));
    for (const [i, name] of names.entries()) {
      const code = COUNTRIES[i]!.code;
      expect(name.trim(), code).not.toBe('');
      expect(name.toLowerCase(), code).not.toBe(code);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('UI resources', () => {
  it('en.json and tr.json have identical key sets', () => {
    expect(keyPaths(tr).sort()).toEqual(keyPaths(en).sort());
  });

  it('uses the same {{placeholders}} for every key in en and tr', () => {
    const placeholders = (s: string) => [...new Set(s.match(/\{\{\s*\w+\s*\}\}/g) ?? [])].map((p) => p.replace(/\s/g, '')).sort();
    const at = (obj: unknown, path: string) =>
      path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj) as string;
    for (const path of keyPaths(en)) {
      expect(placeholders(at(tr, path)), path).toEqual(placeholders(at(en, path)));
    }
  });

  it('has no empty strings', () => {
    for (const v of [...leafValues(en), ...leafValues(tr)]) expect(v.trim()).not.toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { COUNTRIES, getCountry } from './countries';

describe('COUNTRIES', () => {
  it('lists the 193 UN member states', () => {
    expect(COUNTRIES).toHaveLength(193);
  });

  it('has unique, lowercase ISO alpha-2 codes', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z]{2}$/);
  });

  it('has unique non-empty names', () => {
    const names = COUNTRIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.trim()).not.toBe('');
  });

  it('looks up by code case-insensitively', () => {
    expect(getCountry('FR')?.name).toBe('France');
    expect(getCountry('xx')).toBeUndefined();
  });
});

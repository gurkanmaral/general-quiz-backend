import { describe, expect, it } from 'vitest';
import { COUNTRIES } from './countries';
import { CONTINENTS, REGIONS, continentOf, poolFor } from './regions';

describe('regions', () => {
  it('maps each of the 193 UN members to exactly one continent, with no extra codes', () => {
    const codes = COUNTRIES.map((c) => c.code);
    for (const code of codes) expect(CONTINENTS, code).toContain(continentOf(code));
    const all = CONTINENTS.flatMap((c) => poolFor(c));
    expect(all).toHaveLength(193);
    expect(new Set(all)).toEqual(new Set(codes));
  });

  it('uses the UN M49 continents', () => {
    expect(continentOf('cy')).toBe('asia');
    expect(continentOf('tr')).toBe('asia');
    expect(continentOf('ru')).toBe('europe');
    expect(continentOf('eg')).toBe('africa');
    expect(continentOf('mx')).toBe('americas');
    expect(continentOf('xx')).toBeUndefined();
    expect(poolFor('oceania')).toHaveLength(14);
    expect(poolFor('africa')).toHaveLength(54);
    expect(poolFor('europe')).toHaveLength(43);
  });

  it('offers All plus the five continents, "all" being every country in COUNTRIES order', () => {
    expect(REGIONS).toEqual(['all', 'africa', 'americas', 'asia', 'europe', 'oceania']);
    expect(poolFor('all')).toEqual(COUNTRIES.map((c) => c.code));
  });
});

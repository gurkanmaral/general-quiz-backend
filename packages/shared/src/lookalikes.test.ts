import { describe, expect, it } from 'vitest';
import { getCountry } from './countries';
import { groupOf, LOOKALIKE_GROUPS } from './lookalikes';

describe('Look-alike Groups', () => {
  it('only uses UN members, has ≥2 members per group and no code in two groups', () => {
    const seen = new Set<string>();
    expect(LOOKALIKE_GROUPS.length).toBeGreaterThanOrEqual(20);
    for (const group of LOOKALIKE_GROUPS) {
      expect(group.length).toBeGreaterThanOrEqual(2);
      for (const code of group) {
        expect(getCountry(code), code).toBeDefined();
        expect(seen.has(code), `${code} is in two groups`).toBe(false);
        seen.add(code);
      }
    }
  });

  it('finds the group of a code', () => {
    expect(groupOf('td')).toEqual(['td', 'ro', 'ad', 'md']);
    expect(groupOf('BE')).toEqual(['be', 'de']);
    expect(groupOf('fr')).toBeUndefined();
  });
});

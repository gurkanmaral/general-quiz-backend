import { describe, expect, it } from 'vitest';
import { COUNTRIES } from './countries';
import { COUNTRY_GEO, geoOf } from './geo';

describe('COUNTRY_GEO', () => {
  it('has a point for every one of the 193 countries and nothing else', () => {
    for (const { code } of COUNTRIES) expect(COUNTRY_GEO[code], code).toBeDefined();
    expect(Object.keys(COUNTRY_GEO)).toHaveLength(COUNTRIES.length);
  });

  it('keeps every point in range', () => {
    for (const [code, { lat, lng }] of Object.entries(COUNTRY_GEO)) {
      expect(Number.isFinite(lat) && lat >= -90 && lat <= 90, `${code} lat ${lat}`).toBe(true);
      expect(Number.isFinite(lng) && lng >= -180 && lng <= 180, `${code} lng ${lng}`).toBe(true);
    }
  });

  it('places a few well-known countries roughly right', () => {
    const fr = geoOf('fr')!;
    expect(fr.lat).toBeGreaterThan(41);
    expect(fr.lat).toBeLessThan(52);
    expect(fr.lng).toBeGreaterThan(-5);
    expect(fr.lng).toBeLessThan(9);
    expect(geoOf('AU')!.lat).toBeLessThan(0);
    expect(geoOf('br')!.lng).toBeLessThan(0);
  });

  it('looks up case-insensitively and returns undefined for unknown codes', () => {
    expect(geoOf('JP')).toEqual(COUNTRY_GEO.jp);
    expect(geoOf('xx')).toBeUndefined();
    expect(geoOf('toString')).toBeUndefined();
  });
});

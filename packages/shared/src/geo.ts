import { COUNTRY_GEO, type LatLng } from './geoData';

export { COUNTRY_GEO, type LatLng };

/** The representative point of a country (case-insensitive code), or undefined if unknown. */
export function geoOf(code: string): LatLng | undefined {
  const key = code.toLowerCase();
  return Object.prototype.hasOwnProperty.call(COUNTRY_GEO, key) ? COUNTRY_GEO[key] : undefined;
}

import { describe, expect, it } from 'vitest';
import { dayNumber, rotationSlug } from './knoSchedule';

describe('Daily rotation', () => {
  const rotation = { anchor: '1970-01-01', questions: ['a', 'b', 'c'] };

  it('counts calendar days from the epoch', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('2026-11-16')).toBe(20_773);
  });

  it('cycles through the rotation, including dates before the anchor', () => {
    expect(rotationSlug(rotation, '1970-01-01')).toBe('a');
    expect(rotationSlug(rotation, '1970-01-03')).toBe('c');
    expect(rotationSlug(rotation, '1970-01-04')).toBe('a');
    expect(rotationSlug(rotation, '1969-12-31')).toBe('c');
    expect(rotationSlug({ anchor: '2026-11-16', questions: ['x', 'y'] }, '2026-11-17')).toBe('y');
  });

  it('returns undefined for an empty rotation', () => {
    expect(rotationSlug({ anchor: '1970-01-01', questions: [] }, '2026-11-16')).toBeUndefined();
  });
});

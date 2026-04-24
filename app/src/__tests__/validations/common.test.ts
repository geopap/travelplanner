import { describe, it, expect } from 'vitest';
import {
  UuidSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  Iso4217Schema,
  PageSchema,
  daysBetween,
} from '@/lib/validations/common';

describe('UuidSchema', () => {
  it('accepts v4 UUIDs', () => {
    expect(
      UuidSchema.safeParse('11111111-2222-4333-8444-555555555555').success,
    ).toBe(true);
  });
  it('rejects malformed UUID', () => {
    expect(UuidSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('IsoDateSchema', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(IsoDateSchema.safeParse('2026-04-24').success).toBe(true);
  });
  it('rejects bad month', () => {
    expect(IsoDateSchema.safeParse('2026-13-01').success).toBe(false);
  });
  it('rejects wrong format', () => {
    expect(IsoDateSchema.safeParse('04/24/2026').success).toBe(false);
  });
});

describe('IsoDateTimeSchema', () => {
  it('accepts offset datetime', () => {
    expect(IsoDateTimeSchema.safeParse('2026-04-24T10:00:00Z').success).toBe(true);
    expect(
      IsoDateTimeSchema.safeParse('2026-04-24T10:00:00+02:00').success,
    ).toBe(true);
  });
  it('rejects datetime without offset', () => {
    expect(IsoDateTimeSchema.safeParse('2026-04-24T10:00:00').success).toBe(false);
  });
});

describe('Iso4217Schema', () => {
  it('accepts 3-letter uppercase code', () => {
    expect(Iso4217Schema.safeParse('EUR').success).toBe(true);
    expect(Iso4217Schema.safeParse('JPY').success).toBe(true);
  });
  it('rejects lowercase', () => {
    expect(Iso4217Schema.safeParse('eur').success).toBe(false);
  });
  it('rejects wrong length', () => {
    expect(Iso4217Schema.safeParse('EU').success).toBe(false);
    expect(Iso4217Schema.safeParse('EURO').success).toBe(false);
  });
});

describe('PageSchema', () => {
  it('applies defaults', () => {
    const r = PageSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.limit).toBe(20);
  });
  it('coerces strings', () => {
    const r = PageSchema.parse({ page: '3', limit: '50' });
    expect(r.page).toBe(3);
    expect(r.limit).toBe(50);
  });
  it('rejects limit > 100', () => {
    expect(PageSchema.safeParse({ limit: 101 }).success).toBe(false);
  });
  it('rejects page < 1', () => {
    expect(PageSchema.safeParse({ page: 0 }).success).toBe(false);
  });
});

describe('daysBetween', () => {
  it('returns 0 for same day', () => {
    expect(daysBetween('2026-05-01', '2026-05-01')).toBe(0);
  });
  it('counts the expected diff', () => {
    expect(daysBetween('2026-05-01', '2026-05-10')).toBe(9);
  });
  it('works across month boundary', () => {
    expect(daysBetween('2026-04-28', '2026-05-03')).toBe(5);
  });
});

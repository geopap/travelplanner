import { describe, it, expect } from 'vitest';
import {
  CreateTripInput,
  UpdateTripInput,
  MAX_TRIP_DURATION_DAYS,
} from '@/lib/validations/trips';

const base = {
  name: 'Japan 2026',
  start_date: '2026-05-01',
  end_date: '2026-05-10',
  base_currency: 'EUR',
};

describe('CreateTripInput', () => {
  it('accepts minimum valid payload', () => {
    const r = CreateTripInput.safeParse(base);
    expect(r.success).toBe(true);
  });

  it('accepts optional fields', () => {
    const r = CreateTripInput.safeParse({
      ...base,
      destination: 'Tokyo',
      total_budget: 5000,
      cover_image_url: 'https://example.com/img.jpg',
    });
    expect(r.success).toBe(true);
  });

  it('rejects when end_date < start_date', () => {
    expect(
      CreateTripInput.safeParse({ ...base, end_date: '2026-04-30' }).success,
    ).toBe(false);
  });

  it('rejects trip longer than 365 days', () => {
    expect(
      CreateTripInput.safeParse({
        ...base,
        start_date: '2026-01-01',
        end_date: '2027-01-03',
      }).success,
    ).toBe(false);
  });

  it('accepts trip exactly at 365-day cap', () => {
    const r = CreateTripInput.safeParse({
      ...base,
      start_date: '2026-01-01',
      end_date: '2027-01-01',
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid currency code', () => {
    expect(
      CreateTripInput.safeParse({ ...base, base_currency: 'eu' }).success,
    ).toBe(false);
    expect(
      CreateTripInput.safeParse({ ...base, base_currency: 'EURO' }).success,
    ).toBe(false);
  });

  it('rejects invalid ISO date', () => {
    expect(
      CreateTripInput.safeParse({ ...base, start_date: '2026-13-01' }).success,
    ).toBe(false);
  });

  it('rejects empty name', () => {
    expect(CreateTripInput.safeParse({ ...base, name: '' }).success).toBe(false);
  });

  it('rejects negative total_budget', () => {
    expect(
      CreateTripInput.safeParse({ ...base, total_budget: -1 }).success,
    ).toBe(false);
  });

  it('MAX_TRIP_DURATION_DAYS exported as 365', () => {
    expect(MAX_TRIP_DURATION_DAYS).toBe(365);
  });
});

describe('UpdateTripInput', () => {
  it('accepts partial update with single field', () => {
    expect(UpdateTripInput.safeParse({ name: 'Renamed' }).success).toBe(true);
  });
  it('rejects empty object', () => {
    expect(UpdateTripInput.safeParse({}).success).toBe(false);
  });
  it('rejects when both dates present and end < start', () => {
    expect(
      UpdateTripInput.safeParse({
        start_date: '2026-05-05',
        end_date: '2026-05-01',
      }).success,
    ).toBe(false);
  });
  it('accepts only end_date update', () => {
    expect(UpdateTripInput.safeParse({ end_date: '2026-06-01' }).success).toBe(true);
  });
});

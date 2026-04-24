import { describe, it, expect } from 'vitest';
import {
  CreateItineraryItemInput,
  UpdateItineraryItemInput,
  ItineraryItemType,
} from '@/lib/validations/itinerary-items';

const validUuid = '11111111-2222-4333-8444-555555555555';

describe('ItineraryItemType', () => {
  it('accepts the five known types', () => {
    for (const t of ['transport', 'lodging', 'activity', 'meal', 'note'] as const) {
      expect(ItineraryItemType.safeParse(t).success).toBe(true);
    }
  });
  it('rejects unknown type', () => {
    expect(ItineraryItemType.safeParse('flight').success).toBe(false);
  });
});

describe('CreateItineraryItemInput', () => {
  const base = {
    day_id: validUuid,
    type: 'activity' as const,
    title: 'Visit temple',
  };

  it('accepts minimum valid payload', () => {
    expect(CreateItineraryItemInput.safeParse(base).success).toBe(true);
  });

  it('rejects missing title', () => {
    expect(
      CreateItineraryItemInput.safeParse({ ...base, title: '' }).success,
    ).toBe(false);
  });

  it('rejects bad UUID for day_id', () => {
    expect(
      CreateItineraryItemInput.safeParse({ ...base, day_id: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('accepts nullable day_id', () => {
    expect(
      CreateItineraryItemInput.safeParse({ ...base, day_id: null }).success,
    ).toBe(true);
  });

  it('rejects ISO datetime without offset', () => {
    expect(
      CreateItineraryItemInput.safeParse({
        ...base,
        start_time: '2026-05-01T10:00:00',
      }).success,
    ).toBe(false);
  });

  it('accepts ISO datetime with offset', () => {
    expect(
      CreateItineraryItemInput.safeParse({
        ...base,
        start_time: '2026-05-01T10:00:00Z',
        end_time: '2026-05-01T12:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('rejects end_time before start_time', () => {
    expect(
      CreateItineraryItemInput.safeParse({
        ...base,
        start_time: '2026-05-01T12:00:00Z',
        end_time: '2026-05-01T10:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('rejects negative cost', () => {
    expect(
      CreateItineraryItemInput.safeParse({ ...base, cost: -10 }).success,
    ).toBe(false);
  });

  it('rejects invalid currency code', () => {
    expect(
      CreateItineraryItemInput.safeParse({ ...base, currency: 'eu' }).success,
    ).toBe(false);
  });

  it('rejects invalid URL', () => {
    expect(
      CreateItineraryItemInput.safeParse({
        ...base,
        external_url: 'not a url',
      }).success,
    ).toBe(false);
  });
});

describe('UpdateItineraryItemInput', () => {
  it('accepts single field update', () => {
    expect(UpdateItineraryItemInput.safeParse({ title: 'x' }).success).toBe(true);
  });
  it('rejects empty object', () => {
    expect(UpdateItineraryItemInput.safeParse({}).success).toBe(false);
  });
  it('rejects end < start when both present', () => {
    expect(
      UpdateItineraryItemInput.safeParse({
        start_time: '2026-05-01T12:00:00Z',
        end_time: '2026-05-01T10:00:00Z',
      }).success,
    ).toBe(false);
  });
});

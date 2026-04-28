import { describe, it, expect } from 'vitest';
import {
  AccommodationCreate,
  AccommodationPatch,
  AccommodationRowSchema,
  AccommodationIndicatorRowSchema,
  mapAccommodationRow,
} from '@/lib/validations/accommodations';

const validUuid = '11111111-2222-4333-8444-555555555555';

describe('AccommodationCreate', () => {
  const base = {
    check_in_date: '2026-05-01',
    check_out_date: '2026-05-03',
  };

  it('accepts hotel_name only', () => {
    expect(
      AccommodationCreate.safeParse({ ...base, hotel_name: 'Park Hyatt' })
        .success,
    ).toBe(true);
  });

  it('accepts place_id only', () => {
    expect(
      AccommodationCreate.safeParse({ ...base, place_id: validUuid }).success,
    ).toBe(true);
  });

  it('rejects neither name nor place_id', () => {
    expect(AccommodationCreate.safeParse(base).success).toBe(false);
  });

  it('rejects check_out before check_in', () => {
    expect(
      AccommodationCreate.safeParse({
        check_in_date: '2026-05-03',
        check_out_date: '2026-05-01',
        hotel_name: 'Park Hyatt',
      }).success,
    ).toBe(false);
  });

  it('accepts same-day check-in/out', () => {
    expect(
      AccommodationCreate.safeParse({
        check_in_date: '2026-05-01',
        check_out_date: '2026-05-01',
        hotel_name: 'Capsule',
      }).success,
    ).toBe(true);
  });

  it('rejects cost without currency', () => {
    expect(
      AccommodationCreate.safeParse({
        ...base,
        hotel_name: 'h',
        cost_per_night: 100,
      }).success,
    ).toBe(false);
  });

  it('accepts cost paired with currency', () => {
    expect(
      AccommodationCreate.safeParse({
        ...base,
        hotel_name: 'h',
        total_cost: 250,
        currency: 'EUR',
      }).success,
    ).toBe(true);
  });

  it('rejects extra fields (strict)', () => {
    expect(
      AccommodationCreate.safeParse({
        ...base,
        hotel_name: 'h',
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it('rejects bad currency code', () => {
    expect(
      AccommodationCreate.safeParse({
        ...base,
        hotel_name: 'h',
        total_cost: 100,
        currency: 'eu',
      }).success,
    ).toBe(false);
  });

  it('rejects negative cost', () => {
    expect(
      AccommodationCreate.safeParse({
        ...base,
        hotel_name: 'h',
        cost_per_night: -1,
        currency: 'EUR',
      }).success,
    ).toBe(false);
  });
});

describe('AccommodationPatch — gated identity refinement', () => {
  it('accepts partial patch updating only confirmation (regression)', () => {
    const r = AccommodationPatch.safeParse({ confirmation: 'XYZ' });
    expect(r.success).toBe(true);
  });

  it('accepts partial patch updating only notes', () => {
    expect(AccommodationPatch.safeParse({ notes: 'late check-in' }).success).toBe(
      true,
    );
  });

  it('rejects empty patch', () => {
    expect(AccommodationPatch.safeParse({}).success).toBe(false);
  });

  it('rejects patch that touches identity but clears both', () => {
    // Explicitly setting both to empty/falsey values should fail the gated
    // refinement.
    const r = AccommodationPatch.safeParse({
      hotel_name: undefined,
      place_id: undefined,
    });
    // Since both are undefined, identity is not "touched" — empty object after
    // strip; Zod's partial accepts but the "at least one field" refinement
    // fails. Either way: not success.
    expect(r.success).toBe(false);
  });

  it('rejects check_out before check_in in patch', () => {
    expect(
      AccommodationPatch.safeParse({
        check_in_date: '2026-05-05',
        check_out_date: '2026-05-04',
      }).success,
    ).toBe(false);
  });

  it('rejects cost without currency in patch', () => {
    expect(
      AccommodationPatch.safeParse({ cost_per_night: 100 }).success,
    ).toBe(false);
  });

  it('rejects extra fields (strict)', () => {
    expect(
      AccommodationPatch.safeParse({ confirmation: 'X', extra: 1 }).success,
    ).toBe(false);
  });
});

describe('AccommodationRowSchema + mapAccommodationRow', () => {
  const row = {
    id: '00000000-0000-4000-8000-000000000aaa',
    trip_id: '00000000-0000-4000-8000-000000000010',
    place_id: null,
    hotel_name: 'Park Hyatt',
    check_in_date: '2026-05-01',
    check_out_date: '2026-05-03',
    confirmation: null,
    cost_per_night: null,
    total_cost: null,
    currency: null,
    notes: null,
    created_by: '00000000-0000-4000-8000-000000000001',
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    place: null,
  };

  it('parses a row with null place', () => {
    expect(AccommodationRowSchema.safeParse(row).success).toBe(true);
  });

  it('mapAccommodationRow flattens an array-shape join', () => {
    const placed = {
      ...row,
      place_id: '00000000-0000-4000-8000-000000000bbb',
      place: [
        {
          id: '00000000-0000-4000-8000-000000000bbb',
          name: 'Park Hyatt Tokyo',
          formatted_address: 'Shinjuku',
          lat: 35.69,
          lng: 139.69,
        },
      ],
    };
    const parsed = AccommodationRowSchema.parse(placed);
    const mapped = mapAccommodationRow(parsed);
    expect(mapped.place).toBeTruthy();
    if (mapped.place && !Array.isArray(mapped.place)) {
      expect(mapped.place.id).toBe('00000000-0000-4000-8000-000000000bbb');
    }
  });
});

describe('AccommodationIndicatorRowSchema', () => {
  it('accepts known indicator types', () => {
    for (const t of ['check_in', 'in_stay', 'check_out', 'same_day'] as const) {
      const r = AccommodationIndicatorRowSchema.safeParse({
        trip_id: '00000000-0000-4000-8000-000000000010',
        trip_day_id: '00000000-0000-4000-8000-000000000020',
        day_date: '2026-05-01',
        accommodation_id: '00000000-0000-4000-8000-000000000aaa',
        hotel_name: 'h',
        place_id: null,
        indicator_type: t,
      });
      expect(r.success).toBe(true);
    }
  });
  it('rejects unknown indicator_type', () => {
    expect(
      AccommodationIndicatorRowSchema.safeParse({
        trip_id: '00000000-0000-4000-8000-000000000010',
        trip_day_id: '00000000-0000-4000-8000-000000000020',
        day_date: '2026-05-01',
        accommodation_id: '00000000-0000-4000-8000-000000000aaa',
        hotel_name: null,
        place_id: null,
        indicator_type: 'unknown',
      }).success,
    ).toBe(false);
  });
});

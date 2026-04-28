import { describe, it, expect } from 'vitest';
import {
  TransportMode,
  TransportationCreate,
  TransportationPatch,
  TransportationRowSchema,
  TransportationListRowSchema,
} from '@/lib/validations/transportation';
import {
  CreateItineraryItemInput,
  ItineraryItemRowSchema,
} from '@/lib/validations/itinerary-items';

const validUuid = '11111111-2222-4333-8444-555555555555';

describe('TransportMode enum', () => {
  it.each(['flight', 'train', 'bus', 'car', 'ferry'] as const)(
    'accepts %s',
    (m) => {
      expect(TransportMode.safeParse(m).success).toBe(true);
    },
  );
  it('rejects unknown mode (e.g. "boat")', () => {
    expect(TransportMode.safeParse('boat').success).toBe(false);
  });
});

describe('TransportationCreate', () => {
  it('accepts minimal payload (mode only)', () => {
    expect(TransportationCreate.safeParse({ mode: 'flight' }).success).toBe(
      true,
    );
  });

  it('rejects naive datetime without offset for departure_time', () => {
    const r = TransportationCreate.safeParse({
      mode: 'flight',
      departure_time: '2026-05-01T10:00:00',
    });
    expect(r.success).toBe(false);
  });

  it('accepts ISO datetime with Z offset', () => {
    expect(
      TransportationCreate.safeParse({
        mode: 'flight',
        departure_time: '2026-05-01T10:00:00Z',
        arrival_time: '2026-05-01T13:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('rejects arrival before departure', () => {
    expect(
      TransportationCreate.safeParse({
        mode: 'train',
        departure_time: '2026-05-01T13:00:00Z',
        arrival_time: '2026-05-01T10:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('rejects cost without currency', () => {
    expect(
      TransportationCreate.safeParse({ mode: 'bus', cost: 10 }).success,
    ).toBe(false);
  });

  it('rejects currency without cost', () => {
    expect(
      TransportationCreate.safeParse({ mode: 'bus', currency: 'EUR' })
        .success,
    ).toBe(false);
  });

  it('accepts cost+currency together', () => {
    expect(
      TransportationCreate.safeParse({
        mode: 'flight',
        cost: 200,
        currency: 'EUR',
      }).success,
    ).toBe(true);
  });

  it('rejects extra fields (strict)', () => {
    expect(
      TransportationCreate.safeParse({
        mode: 'flight',
        flight_number: 'AB123',
      }).success,
    ).toBe(false);
  });
});

describe('TransportationPatch', () => {
  it('accepts empty patch', () => {
    expect(TransportationPatch.safeParse({}).success).toBe(true);
  });
  it('allows nulling carrier', () => {
    expect(TransportationPatch.safeParse({ carrier: null }).success).toBe(
      true,
    );
  });
  it('rejects arrival before departure when both supplied', () => {
    expect(
      TransportationPatch.safeParse({
        departure_time: '2026-05-01T13:00:00Z',
        arrival_time: '2026-05-01T10:00:00Z',
      }).success,
    ).toBe(false);
  });
  it('rejects extra field', () => {
    expect(
      TransportationPatch.safeParse({ unknown: true }).success,
    ).toBe(false);
  });
});

describe('CreateItineraryItemInput discriminated union — transport variant', () => {
  const baseTransport = {
    type: 'transport' as const,
    title: 'Tokyo → Kyoto',
    day_id: validUuid,
    transportation: { mode: 'train' as const },
  };

  it('accepts a valid transport variant', () => {
    expect(CreateItineraryItemInput.safeParse(baseTransport).success).toBe(
      true,
    );
  });

  it('AC-10: rejects parent cost on transport variant', () => {
    expect(
      CreateItineraryItemInput.safeParse({ ...baseTransport, cost: 50 })
        .success,
    ).toBe(false);
  });

  it('AC-10: rejects parent currency on transport variant', () => {
    expect(
      CreateItineraryItemInput.safeParse({
        ...baseTransport,
        currency: 'EUR',
      }).success,
    ).toBe(false);
  });

  it('rejects transport variant missing transportation sub-object', () => {
    const { transportation: _omit, ...withoutTrans } = baseTransport;
    void _omit;
    expect(CreateItineraryItemInput.safeParse(withoutTrans).success).toBe(
      false,
    );
  });

  it('rejects non-transport variant carrying transportation sub-object', () => {
    expect(
      CreateItineraryItemInput.safeParse({
        type: 'activity',
        title: 'x',
        day_id: validUuid,
        transportation: { mode: 'train' },
      }).success,
    ).toBe(false);
  });

  it('non-transport variant accepts cost + currency', () => {
    expect(
      CreateItineraryItemInput.safeParse({
        type: 'activity',
        title: 'x',
        day_id: validUuid,
        cost: 20,
        currency: 'EUR',
      }).success,
    ).toBe(true);
  });
});

describe('TransportationRowSchema — round-trip', () => {
  it('parses a realistic Supabase row without unsafe casts', () => {
    const row = {
      id: '00000000-0000-4000-8000-000000000abc',
      itinerary_item_id: '00000000-0000-4000-8000-000000000def',
      trip_id: '00000000-0000-4000-8000-000000000010',
      mode: 'flight',
      carrier: 'JAL',
      confirmation: 'ABC123',
      departure_location: 'NRT',
      arrival_location: 'KIX',
      departure_time: '2026-05-01T08:00:00+00:00',
      arrival_time: '2026-05-01T10:30:00+00:00',
      cost: 250,
      currency: 'EUR',
      notes: null,
      created_by: '00000000-0000-4000-8000-000000000001',
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
    };
    const r = TransportationRowSchema.safeParse(row);
    expect(r.success).toBe(true);
  });

  it('TransportationListRowSchema accepts joined item as object or array', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000abc',
      itinerary_item_id: '00000000-0000-4000-8000-000000000def',
      trip_id: '00000000-0000-4000-8000-000000000010',
      mode: 'train' as const,
      carrier: null,
      confirmation: null,
      departure_location: null,
      arrival_location: null,
      departure_time: null,
      arrival_time: null,
      cost: null,
      currency: null,
      notes: null,
      created_by: null,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
    };
    const itemRef = {
      id: '00000000-0000-4000-8000-000000000def',
      day_id: '00000000-0000-4000-8000-000000000020',
      title: 'leg',
    };
    expect(
      TransportationListRowSchema.safeParse({ ...base, item: itemRef })
        .success,
    ).toBe(true);
    expect(
      TransportationListRowSchema.safeParse({ ...base, item: [itemRef] })
        .success,
    ).toBe(true);
  });

  it('ItineraryItemRowSchema parses transport-typed row (regression for dead-cast removal)', () => {
    const row = {
      id: '00000000-0000-4000-8000-000000000abc',
      trip_id: '00000000-0000-4000-8000-000000000010',
      day_id: '00000000-0000-4000-8000-000000000020',
      type: 'transport',
      title: 'Tokyo → Kyoto',
      start_time: '2026-05-01T08:00:00Z',
      end_time: null,
      external_url: null,
      cost: null,
      currency: null,
      notes: null,
      created_by: '00000000-0000-4000-8000-000000000001',
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
    };
    expect(ItineraryItemRowSchema.safeParse(row).success).toBe(true);
  });
});

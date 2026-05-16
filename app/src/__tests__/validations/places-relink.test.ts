/**
 * B-026 — Validation tests for RelinkBodySchema.
 * Strict body: only `from_place_id` (UUID) + `to_google_place_id` (Google opaque id).
 */
import { describe, it, expect } from 'vitest';
import { RelinkBodySchema } from '@/lib/validations/places';

const VALID_UUID = '00000000-0000-4000-8000-000000000010';
const VALID_GPID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

describe('RelinkBodySchema (B-026)', () => {
  it('accepts a valid UUID + valid Google place id', () => {
    const r = RelinkBodySchema.safeParse({
      from_place_id: VALID_UUID,
      to_google_place_id: VALID_GPID,
    });
    expect(r.success).toBe(true);
  });

  it('rejects when extra `trip_id` is present (strict)', () => {
    const r = RelinkBodySchema.safeParse({
      from_place_id: VALID_UUID,
      to_google_place_id: VALID_GPID,
      trip_id: '00000000-0000-4000-8000-000000000099',
    });
    expect(r.success).toBe(false);
  });

  it('rejects when `from_place_id` is missing', () => {
    const r = RelinkBodySchema.safeParse({
      to_google_place_id: VALID_GPID,
    });
    expect(r.success).toBe(false);
  });

  it('rejects when `to_google_place_id` is missing', () => {
    const r = RelinkBodySchema.safeParse({
      from_place_id: VALID_UUID,
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed `from_place_id` (not UUID)', () => {
    const r = RelinkBodySchema.safeParse({
      from_place_id: 'not-a-uuid',
      to_google_place_id: VALID_GPID,
    });
    expect(r.success).toBe(false);
  });

  it('rejects `to_google_place_id` containing illegal chars (space)', () => {
    const r = RelinkBodySchema.safeParse({
      from_place_id: VALID_UUID,
      to_google_place_id: 'ChIJN1t tDeuEmsRUsoyG83frY4',
    });
    expect(r.success).toBe(false);
  });

  it('rejects `to_google_place_id` shorter than 8 chars', () => {
    const r = RelinkBodySchema.safeParse({
      from_place_id: VALID_UUID,
      to_google_place_id: 'short',
    });
    expect(r.success).toBe(false);
  });

  it('rejects `to_google_place_id` with disallowed punctuation (e.g. "!")', () => {
    const r = RelinkBodySchema.safeParse({
      from_place_id: VALID_UUID,
      to_google_place_id: 'ChIJN1t_tDeuEmsR!soyG83frY4',
    });
    expect(r.success).toBe(false);
  });
});

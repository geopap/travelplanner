/**
 * Deterministic test data factories. No randomness — tests must be reproducible.
 */

export const FIXED_USER_ID = '00000000-0000-4000-8000-000000000001';
export const FIXED_OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';
export const FIXED_TRIP_ID = '00000000-0000-4000-8000-000000000010';
export const FIXED_DAY_ID = '00000000-0000-4000-8000-000000000020';
export const FIXED_ITEM_ID = '00000000-0000-4000-8000-000000000030';

export function makeTripInput(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    name: 'Japan 2026',
    start_date: '2026-05-01',
    end_date: '2026-05-03',
    base_currency: 'EUR',
    ...overrides,
  };
}

export function makeItemInput(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    day_id: FIXED_DAY_ID,
    type: 'activity',
    title: 'Visit temple',
    ...overrides,
  };
}

/**
 * Build a minimal base64url-encoded JWT used by decodeJwtPayload.
 * Not cryptographically signed — signature segment is arbitrary.
 */
export function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown): string => {
    const json = JSON.stringify(obj);
    return Buffer.from(json, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  };
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.fakesignature`;
}

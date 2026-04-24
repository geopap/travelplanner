import { describe, it, expect } from 'vitest';
import { UpdateTripDayInput } from '@/lib/validations/trip-days';

describe('UpdateTripDayInput', () => {
  it('accepts title only', () => {
    expect(UpdateTripDayInput.safeParse({ title: 'Arrival' }).success).toBe(true);
  });
  it('accepts notes only', () => {
    expect(UpdateTripDayInput.safeParse({ notes: 'Take umbrella' }).success).toBe(true);
  });
  it('accepts null title (clearing)', () => {
    expect(UpdateTripDayInput.safeParse({ title: null }).success).toBe(true);
  });
  it('rejects empty object', () => {
    expect(UpdateTripDayInput.safeParse({}).success).toBe(false);
  });
  it('rejects title over 120 chars', () => {
    expect(
      UpdateTripDayInput.safeParse({ title: 'a'.repeat(121) }).success,
    ).toBe(false);
  });
  it('rejects notes over 5000 chars', () => {
    expect(
      UpdateTripDayInput.safeParse({ notes: 'x'.repeat(5001) }).success,
    ).toBe(false);
  });
});

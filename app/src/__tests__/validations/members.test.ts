import { describe, it, expect } from 'vitest';
import {
  MemberRoleUpdateSchema,
  TripRoleSchema,
} from '@/lib/validations/members';

describe('TripRoleSchema', () => {
  it.each(['owner', 'editor', 'viewer'] as const)('accepts %s', (r) => {
    expect(TripRoleSchema.safeParse(r).success).toBe(true);
  });
  it('rejects unknown role', () => {
    expect(TripRoleSchema.safeParse('admin').success).toBe(false);
  });
});

describe('MemberRoleUpdateSchema', () => {
  it('accepts each valid role', () => {
    expect(MemberRoleUpdateSchema.safeParse({ role: 'editor' }).success).toBe(
      true,
    );
    expect(MemberRoleUpdateSchema.safeParse({ role: 'owner' }).success).toBe(
      true,
    );
    expect(MemberRoleUpdateSchema.safeParse({ role: 'viewer' }).success).toBe(
      true,
    );
  });
  it('rejects missing role', () => {
    expect(MemberRoleUpdateSchema.safeParse({}).success).toBe(false);
  });
  it('rejects invalid role', () => {
    expect(
      MemberRoleUpdateSchema.safeParse({ role: 'superuser' }).success,
    ).toBe(false);
  });
  it('strict: rejects extra fields', () => {
    expect(
      MemberRoleUpdateSchema.safeParse({ role: 'editor', extra: 1 }).success,
    ).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { InvitationCreate } from '@/lib/validations/invitations';

describe('InvitationCreate — happy path', () => {
  it('accepts editor', () => {
    const r = InvitationCreate.safeParse({
      email: 'alice@example.com',
      role: 'editor',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe('alice@example.com');
      expect(r.data.role).toBe('editor');
    }
  });

  it('accepts viewer', () => {
    const r = InvitationCreate.safeParse({
      email: 'bob@example.com',
      role: 'viewer',
    });
    expect(r.success).toBe(true);
  });

  it('lowercases email at the validation boundary', () => {
    const r = InvitationCreate.safeParse({
      email: 'Alice.Mixed+Tag@EXAMPLE.COM',
      role: 'editor',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe('alice.mixed+tag@example.com');
    }
  });

  it('trims whitespace around email', () => {
    const r = InvitationCreate.safeParse({
      email: '  carl@example.com  ',
      role: 'viewer',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe('carl@example.com');
    }
  });
});

describe('InvitationCreate — rejection cases', () => {
  it('rejects when email is missing', () => {
    const r = InvitationCreate.safeParse({ role: 'editor' });
    expect(r.success).toBe(false);
  });

  it('rejects malformed email', () => {
    const r = InvitationCreate.safeParse({
      email: 'not-an-email',
      role: 'editor',
    });
    expect(r.success).toBe(false);
  });

  it('rejects email longer than 254 chars', () => {
    const longLocal = 'a'.repeat(250);
    const r = InvitationCreate.safeParse({
      email: `${longLocal}@example.com`,
      role: 'editor',
    });
    expect(r.success).toBe(false);
  });

  it('rejects role "owner"', () => {
    const r = InvitationCreate.safeParse({
      email: 'alice@example.com',
      role: 'owner',
    });
    expect(r.success).toBe(false);
  });

  it('rejects role "admin"', () => {
    const r = InvitationCreate.safeParse({
      email: 'alice@example.com',
      role: 'admin',
    });
    expect(r.success).toBe(false);
  });

  it('rejects role missing', () => {
    const r = InvitationCreate.safeParse({ email: 'alice@example.com' });
    expect(r.success).toBe(false);
  });

  it('rejects non-string email (number)', () => {
    const r = InvitationCreate.safeParse({ email: 12345, role: 'editor' });
    expect(r.success).toBe(false);
  });

  it('rejects non-string role (number)', () => {
    const r = InvitationCreate.safeParse({
      email: 'alice@example.com',
      role: 1,
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty body', () => {
    const r = InvitationCreate.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects null', () => {
    const r = InvitationCreate.safeParse(null);
    expect(r.success).toBe(false);
  });
});

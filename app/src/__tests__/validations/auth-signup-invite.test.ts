import { describe, it, expect } from 'vitest';
import { SignupInput } from '@/lib/validations/auth';

/**
 * B-019 R5 — focused regression tests for the `invite_token` field in
 * SignupInput. These complement `auth.test.ts` by pinning the exact
 * length/charset boundaries the schema enforces (16..256 chars, base64url
 * charset `[A-Za-z0-9_-]`).
 */

const baseValid = {
  email: 'user@example.com',
  password: 'Str0ngPassword!',
  confirm_password: 'Str0ngPassword!',
};

function withToken(token: string): unknown {
  return { ...baseValid, invite_token: token };
}

describe('SignupInput.invite_token — regex bounds (B-019)', () => {
  it('accepts the minimum length (16 chars)', () => {
    const r = SignupInput.safeParse(withToken('A'.repeat(16)));
    expect(r.success).toBe(true);
  });

  it('rejects below the minimum (15 chars)', () => {
    const r = SignupInput.safeParse(withToken('A'.repeat(15)));
    expect(r.success).toBe(false);
  });

  it('accepts the maximum length (256 chars)', () => {
    const r = SignupInput.safeParse(withToken('A'.repeat(256)));
    expect(r.success).toBe(true);
  });

  it('rejects above the maximum (257 chars)', () => {
    const r = SignupInput.safeParse(withToken('A'.repeat(257)));
    expect(r.success).toBe(false);
  });

  it('accepts a typical 32-byte base64url token (43 chars, no padding)', () => {
    // base64url of 32 random bytes: length 43, charset [A-Za-z0-9_-]
    const t = 'abcDEF123-_xyzABCdef456-_GHIjkl789mnoPQR_-X';
    expect(t.length).toBe(43);
    const r = SignupInput.safeParse(withToken(t));
    expect(r.success).toBe(true);
  });

  it('accepts all base64url charset members (A-Z a-z 0-9 _ -)', () => {
    const t =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    expect(t.length).toBe(64);
    const r = SignupInput.safeParse(withToken(t));
    expect(r.success).toBe(true);
  });

  it('rejects standard-base64 padding character "="', () => {
    // 43-char body + '=' to bring to 44; '=' is not allowed in base64url.
    const r = SignupInput.safeParse(withToken('A'.repeat(43) + '='));
    expect(r.success).toBe(false);
  });

  it('rejects standard-base64 chars "+" and "/"', () => {
    expect(
      SignupInput.safeParse(withToken('A'.repeat(20) + '+' + 'A'.repeat(20)))
        .success,
    ).toBe(false);
    expect(
      SignupInput.safeParse(withToken('A'.repeat(20) + '/' + 'A'.repeat(20)))
        .success,
    ).toBe(false);
  });

  it('rejects whitespace inside the token', () => {
    const r = SignupInput.safeParse(withToken('A'.repeat(20) + ' ' + 'A'.repeat(20)));
    expect(r.success).toBe(false);
  });

  it('rejects punctuation/control characters', () => {
    for (const bad of ['!', '@', '#', '.', ',', ';', '\n', '\t']) {
      const r = SignupInput.safeParse(
        withToken('A'.repeat(20) + bad + 'A'.repeat(20)),
      );
      expect(r.success).toBe(false);
    }
  });

  it('rejects empty string', () => {
    expect(SignupInput.safeParse(withToken('')).success).toBe(false);
  });
});

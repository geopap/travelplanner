import { describe, it, expect } from 'vitest';
import {
  SignupInput,
  SigninInput,
  PasswordResetInput,
  PasswordResetCompleteInput,
} from '@/lib/validations/auth';

describe('SignupInput', () => {
  const valid = {
    email: 'user@example.com',
    password: 'Str0ngPassword!',
    confirm_password: 'Str0ngPassword!',
  };

  it('accepts a valid signup payload', () => {
    expect(SignupInput.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid email', () => {
    const r = SignupInput.safeParse({ ...valid, email: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('rejects email over 254 characters', () => {
    const long = 'a'.repeat(250) + '@example.com';
    expect(SignupInput.safeParse({ ...valid, email: long }).success).toBe(false);
  });

  it('rejects password under 12 characters', () => {
    expect(
      SignupInput.safeParse({ ...valid, password: 'Short1!', confirm_password: 'Short1!' }).success,
    ).toBe(false);
  });

  it('rejects password without uppercase', () => {
    expect(
      SignupInput.safeParse({ ...valid, password: 'nouppercase1!', confirm_password: 'nouppercase1!' }).success,
    ).toBe(false);
  });

  it('rejects password without lowercase', () => {
    expect(
      SignupInput.safeParse({ ...valid, password: 'NOLOWERCASE1!', confirm_password: 'NOLOWERCASE1!' }).success,
    ).toBe(false);
  });

  it('rejects password without digit', () => {
    expect(
      SignupInput.safeParse({ ...valid, password: 'NoDigitPassword!', confirm_password: 'NoDigitPassword!' }).success,
    ).toBe(false);
  });

  it('rejects mismatched confirm_password', () => {
    const r = SignupInput.safeParse({ ...valid, confirm_password: 'Different1!Password' });
    expect(r.success).toBe(false);
  });
});

describe('SigninInput', () => {
  it('accepts any non-empty password', () => {
    expect(
      SigninInput.safeParse({ email: 'x@y.com', password: 'a' }).success,
    ).toBe(true);
  });
  it('rejects empty password', () => {
    expect(
      SigninInput.safeParse({ email: 'x@y.com', password: '' }).success,
    ).toBe(false);
  });
  it('rejects missing email', () => {
    expect(SigninInput.safeParse({ password: 'xx' }).success).toBe(false);
  });
});

describe('PasswordResetInput', () => {
  it('accepts valid email', () => {
    expect(PasswordResetInput.safeParse({ email: 'x@y.com' }).success).toBe(true);
  });
  it('rejects invalid email', () => {
    expect(PasswordResetInput.safeParse({ email: 'nope' }).success).toBe(false);
  });
});

describe('PasswordResetCompleteInput', () => {
  const valid = {
    access_token: 'a'.repeat(20),
    password: 'Str0ngPassword!',
    confirm_password: 'Str0ngPassword!',
  };
  it('accepts a valid payload', () => {
    expect(PasswordResetCompleteInput.safeParse(valid).success).toBe(true);
  });
  it('rejects short token', () => {
    expect(
      PasswordResetCompleteInput.safeParse({ ...valid, access_token: 'short' }).success,
    ).toBe(false);
  });
  it('rejects mismatched passwords', () => {
    expect(
      PasswordResetCompleteInput.safeParse({ ...valid, confirm_password: 'Other1!Password' }).success,
    ).toBe(false);
  });
});

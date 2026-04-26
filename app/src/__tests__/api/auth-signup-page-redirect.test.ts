import { describe, it, expect, vi } from 'vitest';

/**
 * B-019 AC #1 + R5 scenario 9:
 * Direct visits to `/sign-up` must redirect to `/sign-in?notice=invite_only`.
 * The page calls `redirect()` from next/navigation at module evaluation time.
 */

const redirectMock = vi.fn((url: string) => {
  // next/navigation.redirect throws a sentinel; mimic by throwing a tagged
  // error so we can assert the call AND that execution halts.
  throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;${url}` });
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

import SignUpPage from '@/app/(auth)/sign-up/page';

describe('GET /sign-up — invitation-only redirect (B-019)', () => {
  it('redirects to /sign-in?notice=invite_only', () => {
    expect(() => SignUpPage()).toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith('/sign-in?notice=invite_only');
  });
});

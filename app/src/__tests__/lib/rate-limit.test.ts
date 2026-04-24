import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  checkRateLimit,
  recordFailure,
  resetKey,
  getClientIp,
} from '@/lib/rate-limit';

// Each test uses a unique key to avoid cross-test pollution from the
// module-level Map inside rate-limit.ts.
let counter = 0;
const k = (label: string): string => `${label}-${Date.now()}-${counter++}`;

describe('checkRateLimit', () => {
  it('allows requests under the cap', () => {
    const key = k('under');
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 60_000, 5).ok).toBe(true);
    }
  });

  it('rejects when cap is reached', () => {
    const key = k('cap');
    for (let i = 0; i < 3; i++) checkRateLimit(key, 60_000, 3);
    const r = checkRateLimit(key, 60_000, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterMs).toBeGreaterThanOrEqual(0);
  });

  it('is per-key isolated', () => {
    const a = k('a');
    const b = k('b');
    for (let i = 0; i < 5; i++) checkRateLimit(a, 60_000, 5);
    expect(checkRateLimit(a, 60_000, 5).ok).toBe(false);
    // key b unaffected
    expect(checkRateLimit(b, 60_000, 5).ok).toBe(true);
  });

  it('resets after the window elapses', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-04-24T00:00:00Z'));
      const key = k('window');
      for (let i = 0; i < 3; i++) checkRateLimit(key, 1000, 3);
      expect(checkRateLimit(key, 1000, 3).ok).toBe(false);
      vi.setSystemTime(new Date('2026-04-24T00:00:02Z'));
      expect(checkRateLimit(key, 1000, 3).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resetKey allows immediate retry', () => {
    const key = k('reset');
    for (let i = 0; i < 3; i++) checkRateLimit(key, 60_000, 3);
    expect(checkRateLimit(key, 60_000, 3).ok).toBe(false);
    resetKey(key);
    expect(checkRateLimit(key, 60_000, 3).ok).toBe(true);
  });
});

describe('recordFailure', () => {
  it('increments a counter in an existing window', () => {
    const key = k('fail');
    checkRateLimit(key, 60_000, 10);
    const b1Count = recordFailure(key, 60_000).count;
    const b2Count = recordFailure(key, 60_000).count;
    expect(b2Count).toBe(b1Count + 1);
  });
});

describe('getClientIp', () => {
  it('uses first x-forwarded-for entry', () => {
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
    });
    expect(getClientIp(req)).toBe('203.0.113.1');
  });
  it('falls back to x-real-ip', () => {
    const req = new Request('http://x', {
      headers: { 'x-real-ip': '198.51.100.5' },
    });
    expect(getClientIp(req)).toBe('198.51.100.5');
  });
  it('returns unknown when no header present', () => {
    const req = new Request('http://x');
    expect(getClientIp(req)).toBe('unknown');
  });
});

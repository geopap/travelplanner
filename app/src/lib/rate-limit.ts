/**
 * In-memory fixed-window rate limiter. Keyed by an arbitrary string.
 *
 * Sprint 1 compromise: per-instance memory. Does not hold across Vercel
 * serverless instances. Replace with Upstash Redis in Phase B.
 */

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastSweep = Date.now();

function sweepIfDue(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.windowStart > 60 * 60 * 1000) {
      buckets.delete(key);
    }
  }
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

export function checkRateLimit(
  key: string,
  windowMs: number,
  max: number,
): RateLimitResult {
  const now = Date.now();
  sweepIfDue(now);

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { ok: true };
  }

  if (bucket.count >= max) {
    const retryAfterMs = windowMs - (now - bucket.windowStart);
    return { ok: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  bucket.count += 1;
  return { ok: true };
}

/** Increment a counter without checking — used for post-hoc failure counters. */
export function recordFailure(
  key: string,
  windowMs: number,
): { count: number; windowStart: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    const fresh = { count: 1, windowStart: now };
    buckets.set(key, fresh);
    return fresh;
  }
  bucket.count += 1;
  return bucket;
}

export function resetKey(key: string): void {
  buckets.delete(key);
}

/** Extract a client IP from standard request headers. */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

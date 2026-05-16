/**
 * B-023 — Unit tests for the enrichment script's confidence helper.
 * The helper is the only piece of logic in the script that's pure; everything
 * else is DB / fetch I/O. Tests here lock in the 3-of-3 rule semantics so a
 * silent regression to "pick top-1 always" would break the build.
 */
import { describe, it, expect } from 'vitest';
import {
  passesConfidence,
  type ConfidenceCandidate,
} from '../../../scripts/enrich-accommodations';

const op = (name: string): ConfidenceCandidate => ({
  google_place_id: `g_${name.replace(/\s+/g, '_')}`,
  name,
  business_status: 'OPERATIONAL',
});

describe('passesConfidence', () => {
  it('returns no_results on empty candidate list', () => {
    expect(passesConfidence('Park Hyatt', []).ok).toBe(false);
  });

  it('accepts a clear top-1 OPERATIONAL match', () => {
    const out = passesConfidence('Park Hyatt', [op('Park Hyatt Tokyo')]);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.pick.google_place_id).toBe('g_Park_Hyatt_Tokyo');
  });

  it('rejects when top-1 name does not substring-match', () => {
    const out = passesConfidence('Park Hyatt', [op('Hilton Garden Inn')]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('name_no_match');
  });

  it('rejects when top-1 is not OPERATIONAL', () => {
    const candidates: ConfidenceCandidate[] = [
      { google_place_id: 'g1', name: 'Park Hyatt Tokyo', business_status: 'CLOSED_PERMANENTLY' },
    ];
    const out = passesConfidence('Park Hyatt', candidates);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('not_operational');
  });

  it('rejects when business_status is missing', () => {
    const candidates: ConfidenceCandidate[] = [
      { google_place_id: 'g1', name: 'Park Hyatt Tokyo' },
    ];
    const out = passesConfidence('Park Hyatt', candidates);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('not_operational');
  });

  it('rejects when top-2 also matches (ambiguous_top2)', () => {
    const out = passesConfidence('Hilton Tokyo', [
      op('Hilton Tokyo Bay'),
      op('Hilton Tokyo Odaiba'),
    ]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('ambiguous_top2');
  });

  it('accepts when top-1 matches but top-2 does not', () => {
    const out = passesConfidence('Park Hyatt', [
      op('Park Hyatt Tokyo'),
      op('Hilton Garden Inn'),
    ]);
    expect(out.ok).toBe(true);
  });

  it('matches case-insensitively and after whitespace collapse', () => {
    const out = passesConfidence('  park  hyatt  ', [op('Park Hyatt Tokyo')]);
    expect(out.ok).toBe(true);
  });

  it('matches when query is longer than candidate (user typed more specific)', () => {
    const out = passesConfidence('Park Hyatt Tokyo Shinjuku', [
      op('Park Hyatt Tokyo'),
    ]);
    expect(out.ok).toBe(true);
  });
});

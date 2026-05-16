/**
 * B-035 — ExtractInput union variants + isCaptionOnlyHost helper.
 *
 * Covers the new caption-with-stashed-URL variant introduced for the
 * Instagram/TikTok pre-empt banner, plus the locked host list.
 */
import { describe, it, expect } from 'vitest';

import {
  ExtractInput,
  ExtractInputCaptionWithUrl,
} from '@/lib/validations/import';
import { isCaptionOnlyHost } from '@/lib/utils/import-hosts';

describe('ExtractInput union (B-035)', () => {
  it('accepts URL-only payload', () => {
    const r = ExtractInput.safeParse({
      source_url: 'https://www.youtube.com/watch?v=abc',
    });
    expect(r.success).toBe(true);
  });

  it('accepts caption-only payload', () => {
    const r = ExtractInput.safeParse({ raw_text: 'sushi place is great' });
    expect(r.success).toBe(true);
  });

  it('accepts caption + stashed_source_url payload', () => {
    const r = ExtractInput.safeParse({
      raw_text: 'sushi place is great',
      stashed_source_url: 'https://www.instagram.com/p/DYWoZkMmGgh/',
    });
    expect(r.success).toBe(true);
  });

  it('rejects URL + raw_text combination', () => {
    const r = ExtractInput.safeParse({
      source_url: 'https://example.com',
      raw_text: 'both at once',
    });
    expect(r.success).toBe(false);
  });

  it('rejects URL + stashed_source_url combination', () => {
    const r = ExtractInput.safeParse({
      source_url: 'https://example.com',
      stashed_source_url: 'https://www.instagram.com/p/x/',
    });
    expect(r.success).toBe(false);
  });

  it('rejects stashed_source_url without raw_text', () => {
    const r = ExtractInput.safeParse({
      stashed_source_url: 'https://www.instagram.com/p/x/',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty raw_text in caption-with-stash variant', () => {
    const r = ExtractInputCaptionWithUrl.safeParse({
      raw_text: '',
      stashed_source_url: 'https://www.instagram.com/p/x/',
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed stashed_source_url', () => {
    const r = ExtractInputCaptionWithUrl.safeParse({
      raw_text: 'caption',
      stashed_source_url: 'not-a-url',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty object', () => {
    const r = ExtractInput.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('isCaptionOnlyHost (B-035)', () => {
  it.each([
    'https://instagram.com/p/x',
    'https://www.instagram.com/p/x',
    'https://tiktok.com/@a/video/1',
    'https://www.tiktok.com/@a/video/1',
    'https://vm.tiktok.com/abc/',
  ])('returns true for %s', (u) => {
    expect(isCaptionOnlyHost(u)).toBe(true);
  });

  it('is case-insensitive on hostname', () => {
    expect(isCaptionOnlyHost('https://WWW.INSTAGRAM.COM/p/x')).toBe(true);
  });

  it.each([
    'https://www.youtube.com/watch?v=abc',
    'https://x.com/jack/status/1',
    'https://twitter.com/jack',
    'https://example.com/blog/post',
    'https://m.instagram.com/p/x', // mobile subdomain not in locked list
    'https://instagr.am/p/x', // short link domain not in list
  ])('returns false for %s', (u) => {
    expect(isCaptionOnlyHost(u)).toBe(false);
  });

  it('returns false for invalid URLs without throwing', () => {
    expect(isCaptionOnlyHost('not a url')).toBe(false);
    expect(isCaptionOnlyHost('')).toBe(false);
    expect(isCaptionOnlyHost('   ')).toBe(false);
    expect(isCaptionOnlyHost('javascript:void(0)')).toBe(false);
  });
});

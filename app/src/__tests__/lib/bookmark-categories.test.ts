import { describe, it, expect } from 'vitest';
import {
  narrowCategoryForBookmark,
  BOOKMARK_CATEGORIES,
} from '@/lib/bookmarks/categories';

describe('narrowCategoryForBookmark', () => {
  it('cafe → restaurant', () => {
    expect(narrowCategoryForBookmark('cafe')).toBe('restaurant');
  });
  it('bar → restaurant', () => {
    expect(narrowCategoryForBookmark('bar')).toBe('restaurant');
  });
  it('restaurant → restaurant (identity)', () => {
    expect(narrowCategoryForBookmark('restaurant')).toBe('restaurant');
  });
  it('park → sight', () => {
    expect(narrowCategoryForBookmark('park')).toBe('sight');
  });
  it('sight → sight (identity)', () => {
    expect(narrowCategoryForBookmark('sight')).toBe('sight');
  });
  it('museum → museum (identity)', () => {
    expect(narrowCategoryForBookmark('museum')).toBe('museum');
  });
  it('shopping → shopping (identity)', () => {
    expect(narrowCategoryForBookmark('shopping')).toBe('shopping');
  });
  it('hotel → other', () => {
    expect(narrowCategoryForBookmark('hotel')).toBe('other');
  });
  it('transport_hub → other', () => {
    expect(narrowCategoryForBookmark('transport_hub')).toBe('other');
  });
  it('other → other (identity)', () => {
    expect(narrowCategoryForBookmark('other')).toBe('other');
  });

  it('always returns a value within BOOKMARK_CATEGORIES', () => {
    const allInputs = [
      'restaurant',
      'cafe',
      'bar',
      'sight',
      'museum',
      'shopping',
      'hotel',
      'transport_hub',
      'park',
      'other',
    ] as const;
    for (const c of allInputs) {
      const out = narrowCategoryForBookmark(c);
      expect(BOOKMARK_CATEGORIES).toContain(out);
    }
  });
});

describe('BOOKMARK_CATEGORIES constant', () => {
  it('exposes the five canonical bookmark categories', () => {
    expect([...BOOKMARK_CATEGORIES].sort()).toEqual(
      ['museum', 'other', 'restaurant', 'shopping', 'sight'].sort(),
    );
  });
});

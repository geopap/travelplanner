import { describe, it, expect } from 'vitest';
import { mapGoogleTypesToCategory } from '@/lib/google/categories';

describe('mapGoogleTypesToCategory', () => {
  it('maps restaurant + meal_takeaway to restaurant', () => {
    expect(mapGoogleTypesToCategory(['restaurant', 'point_of_interest'])).toBe(
      'restaurant',
    );
    expect(mapGoogleTypesToCategory(['meal_takeaway'])).toBe('restaurant');
    expect(mapGoogleTypesToCategory(['food'])).toBe('restaurant');
  });

  it('maps cafe / bakery to cafe', () => {
    expect(mapGoogleTypesToCategory(['cafe'])).toBe('cafe');
    expect(mapGoogleTypesToCategory(['bakery'])).toBe('cafe');
  });

  it('maps bar / night_club to bar', () => {
    expect(mapGoogleTypesToCategory(['bar'])).toBe('bar');
    expect(mapGoogleTypesToCategory(['night_club'])).toBe('bar');
  });

  it('maps museum / art_gallery to museum', () => {
    expect(mapGoogleTypesToCategory(['museum'])).toBe('museum');
    expect(mapGoogleTypesToCategory(['art_gallery'])).toBe('museum');
  });

  it('maps tourist_attraction / point_of_interest to sight', () => {
    expect(mapGoogleTypesToCategory(['tourist_attraction'])).toBe('sight');
    expect(mapGoogleTypesToCategory(['landmark'])).toBe('sight');
    expect(mapGoogleTypesToCategory(['point_of_interest'])).toBe('sight');
    expect(mapGoogleTypesToCategory(['church'])).toBe('sight');
  });

  it('maps shopping_mall / store to shopping', () => {
    expect(mapGoogleTypesToCategory(['shopping_mall'])).toBe('shopping');
    expect(mapGoogleTypesToCategory(['store'])).toBe('shopping');
    expect(mapGoogleTypesToCategory(['book_store'])).toBe('shopping');
  });

  it('maps lodging / hotel to hotel', () => {
    expect(mapGoogleTypesToCategory(['lodging'])).toBe('hotel');
    expect(mapGoogleTypesToCategory(['hotel'])).toBe('hotel');
    expect(mapGoogleTypesToCategory(['bed_and_breakfast'])).toBe('hotel');
  });

  it('maps transit types to transport_hub', () => {
    expect(mapGoogleTypesToCategory(['airport'])).toBe('transport_hub');
    expect(mapGoogleTypesToCategory(['train_station'])).toBe('transport_hub');
    expect(mapGoogleTypesToCategory(['subway_station'])).toBe('transport_hub');
    expect(mapGoogleTypesToCategory(['ferry_terminal'])).toBe('transport_hub');
  });

  it('maps park / garden / national_park to park', () => {
    expect(mapGoogleTypesToCategory(['park'])).toBe('park');
    expect(mapGoogleTypesToCategory(['garden'])).toBe('park');
    expect(mapGoogleTypesToCategory(['national_park'])).toBe('park');
  });

  it('returns other when no priority type matches', () => {
    expect(mapGoogleTypesToCategory([])).toBe('other');
    expect(mapGoogleTypesToCategory(['unknown_type'])).toBe('other');
    expect(mapGoogleTypesToCategory(['establishment'])).toBe('other');
  });

  it('priority: restaurant wins over point_of_interest (sight)', () => {
    // A restaurant that also reports point_of_interest must NOT map to sight.
    expect(
      mapGoogleTypesToCategory(['point_of_interest', 'restaurant']),
    ).toBe('restaurant');
  });

  it('priority: museum wins over generic point_of_interest', () => {
    expect(mapGoogleTypesToCategory(['point_of_interest', 'museum'])).toBe(
      'museum',
    );
  });
});

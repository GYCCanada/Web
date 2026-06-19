import { describe, expect, test } from 'bun:test';

import { backfillHomeMissionPhoto } from './home-photo-backfill';
import { defaultHomePage } from './defaults';

describe('backfillHomeMissionPhoto', () => {
  const seededPhoto = defaultHomePage.mission.photo;

  test('fills an absent mission.photo with the seeded default photo', () => {
    const legacy = {
      enabled: true,
      tagline: { en: 'T', fr: 'T' },
      mission: { readStoryLabel: { en: 'R', fr: 'L' } }, // no photo key
      join: {},
      newsletter: {},
    };
    const out = backfillHomeMissionPhoto(legacy) as {
      mission: { readStoryLabel: unknown; photo: unknown };
    };
    expect(out.mission.photo).toEqual(seededPhoto);
    // The sibling is preserved untouched.
    expect(out.mission.readStoryLabel).toEqual({ en: 'R', fr: 'L' });
  });

  test('leaves a PRESENT mission.photo untouched (idempotent — for absence only)', () => {
    const uploaded = {
      mission: {
        readStoryLabel: { en: 'R', fr: 'L' },
        photo: { key: 'images/uploads/x.webp', alt: { en: 'A', fr: 'B' } },
      },
    };
    const out = backfillHomeMissionPhoto(uploaded);
    // Same reference semantics: a present photo means no rewrite.
    expect(out).toBe(uploaded);
  });

  test('running twice equals running once (idempotent)', () => {
    const legacy = { mission: { readStoryLabel: { en: 'R', fr: 'L' } } };
    const once = backfillHomeMissionPhoto(legacy);
    const twice = backfillHomeMissionPhoto(once);
    expect(twice).toEqual(once);
  });

  test('leaves a non-object, or a non-object mission, for the decoder to reject', () => {
    expect(backfillHomeMissionPhoto(null)).toBe(null);
    expect(backfillHomeMissionPhoto('nope')).toBe('nope');
    const badMission = { mission: 'not-an-object' };
    expect(backfillHomeMissionPhoto(badMission)).toBe(badMission);
  });
});

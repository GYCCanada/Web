import { describe, expect, it } from 'bun:test';

import {
  isSeminarPublishReady,
  isSpeakerPublishReady,
} from './publish-readiness';

describe('publish-readiness', () => {
  it('rejects a speaker stub (id only)', () => {
    expect(isSpeakerPublishReady({})).toBe(false);
  });

  it('accepts a fully filled speaker', () => {
    expect(
      isSpeakerPublishReady({
        name: { en: 'Coming Soon', fr: 'Bientôt' },
        activity: { en: 'TBA', fr: 'À venir' },
        bio: { en: 'Details soon.', fr: 'Détails bientôt.' },
        photo: {
          key: 'images/uploads/test.webp',
          alt: { en: 'Coming soon', fr: 'Bientôt' },
        },
      }),
    ).toBe(true);
  });

  it('rejects a seminar with an empty title locale', () => {
    expect(
      isSeminarPublishReady({
        title: { en: 'Coming Soon', fr: '' },
        description: { en: 'Soon', fr: 'Bientôt' },
        speaker: {
          name: { en: 'TBA', fr: 'À venir' },
          bio: { en: 'Bio', fr: 'Bio' },
          photo: {
            key: 'images/uploads/test.webp',
            alt: { en: 'Alt', fr: 'Alt' },
          },
        },
      }),
    ).toBe(false);
  });

  it('accepts a fully filled seminar (title can be a coming-soon placeholder)', () => {
    expect(
      isSeminarPublishReady({
        title: { en: 'Coming Soon', fr: 'Bientôt' },
        description: { en: 'Details soon.', fr: 'Détails bientôt.' },
        speaker: {
          name: { en: 'Coming Soon', fr: 'Bientôt' },
          bio: { en: 'Stay tuned.', fr: 'Restez à l’écoute.' },
          photo: {
            key: 'images/uploads/test.webp',
            alt: { en: 'Coming soon', fr: 'Bientôt' },
          },
        },
      }),
    ).toBe(true);
  });
});

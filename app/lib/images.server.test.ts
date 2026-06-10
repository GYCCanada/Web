import { describe, expect, test as it } from 'effect-bun-test';

import { imageKeyFromPath } from './images.server';

/**
 * The `/images/*` route boundary is the only thing standing between an
 * unauthenticated public request and the bucket's object keys. These tests pin
 * both halves of its contract (`prove-it-works`, `boundary-discipline`):
 *
 *   1. it admits every legitimate managed-image key (uploaded `images/uploads/…`
 *      art and the bundled `public/<year>/…` art the defaults reference), and
 *   2. it refuses the CMS documents that live in the same bucket — above all the
 *      private unpublished `content/site.draft.json` — and any other non-image
 *      object, so the route can never leak them.
 */
describe('imageKeyFromPath — admits legitimate image keys', () => {
  const ok: ReadonlyArray<readonly [string, string]> = [
    ['/images/images/uploads/team-0-photo-1700000000000.png', 'images/uploads/team-0-photo-1700000000000.png'],
    ['/images/images/uploads/hero-1700000000000.webp', 'images/uploads/hero-1700000000000.webp'],
    ['/images/2024/speakers/matt.jpg', '2024/speakers/matt.jpg'],
    ['/images/2025/en/hero-desktop.jpeg', '2025/en/hero-desktop.jpeg'],
    ['/images/2026/fr/hero-desktop.png', '2026/fr/hero-desktop.png'],
    ['/images/team/elijah.jpg', 'team/elijah.jpg'],
    ['/images/logo.svg', 'logo.svg'],
    ['/images/promo.avif', 'promo.avif'],
    ['/images/spinner.gif', 'spinner.gif'],
    ['/images/favicon.ico', 'favicon.ico'],
    // Percent-encoded path separators decode to a plain key.
    ['/images/2024%2Fspeakers%2Fmatt.png', '2024/speakers/matt.png'],
    // Mixed-case extensions are normalized by the allow-list, key preserved.
    ['/images/team/Elijah.JPG', 'team/Elijah.JPG'],
  ];

  for (const [path, key] of ok) {
    it(`admits ${path}`, () => {
      expect(imageKeyFromPath(path)).toBe(key);
    });
  }
});

describe('imageKeyFromPath — refuses the CMS documents (no info disclosure)', () => {
  const blocked: ReadonlyArray<string> = [
    // The reported leak: the private unpublished draft and the live document.
    '/images/content/site.draft.json',
    '/images/content/site.json',
    // Percent-encoded variants must not slip past the allow-list either.
    '/images/content%2Fsite.draft.json',
    // Any other non-image object: configs, archives, plain bucket keys.
    '/images/content/secrets.env',
    '/images/backup.zip',
    '/images/notes.txt',
    // No extension at all is not an image.
    '/images/content/site',
    '/images/images/uploads/no-extension',
  ];

  for (const path of blocked) {
    it(`refuses ${path}`, () => {
      expect(imageKeyFromPath(path)).toBeNull();
    });
  }
});

describe('imageKeyFromPath — refuses traversal / malformed keys', () => {
  const blocked: ReadonlyArray<string> = [
    '/images/',
    '/images/../content/site.json',
    '/images/a/../../etc/passwd.png',
    '/images/%2e%2e/content/site.json',
    '/images//double/slash.png',
    '/images/a\\b.png',
    '/images/%C0', // malformed percent-encoding → decode throws
  ];

  for (const path of blocked) {
    it(`refuses ${path}`, () => {
      expect(imageKeyFromPath(path)).toBeNull();
    });
  }
});

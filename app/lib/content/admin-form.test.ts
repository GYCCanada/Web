import { describe, expect, it } from 'bun:test';
import { Effect, Schema } from 'effect';

import {
  assembleOverrides,
  deepMerge,
  extensionForType,
  imageUploadTarget,
  isAcceptedImageType,
  setAtPath,
  uploadedImageKey,
  type Json,
} from './admin-form';
import { defaultContent } from './defaults';
import { SiteContent } from './schema';

/**
 * The `/admin` editor edits the one `SiteContent` document via a
 * merge-onto-current-document strategy (C5). These pin the pure helpers that do
 * the merge so a single edited field can never silently drop the rest of the
 * document, and so an edited-then-merged document still decodes at the boundary.
 */

const encode = Schema.encodeUnknownEffect(SiteContent);
const decode = Schema.decodeUnknownEffect(SiteContent);

const entries = (
  record: Record<string, string>,
): Iterable<readonly [string, string]> => Object.entries(record);

describe('assembleOverrides', () => {
  it('parses dotted form names into a nested object', () => {
    const result = assembleOverrides(
      entries({
        'conferences.0.themeName.en': 'New Title',
        'team.1.name': 'Jane Doe',
        intent: 'save-draft',
        _array: 'ignored',
      }),
    );
    expect(result).toEqual({
      conferences: [{ themeName: { en: 'New Title' } }],
      team: [undefined as unknown as Json, { name: 'Jane Doe' }] as Json,
    });
  });

  it('coerces bible chapter/verse leaves to numbers', () => {
    const result = assembleOverrides(
      entries({
        'conferences.0.bible.chapter': '12',
        'conferences.0.bible.verse': '3',
      }),
    ) as { conferences: { bible: { chapter: number; verse: number } }[] };
    expect(result.conferences[0]?.bible.chapter).toBe(12);
    expect(result.conferences[0]?.bible.verse).toBe(3);
  });
});

describe('deepMerge', () => {
  it('overlays a leaf without dropping sibling keys', () => {
    const merged = deepMerge(
      { a: { x: 1, y: 2 }, b: 3 },
      { a: { x: 9 } },
    );
    expect(merged).toEqual({ a: { x: 9, y: 2 }, b: 3 });
  });

  it('merges arrays element-by-element by index', () => {
    const merged = deepMerge(
      { list: [{ k: 'a', keep: true }, { k: 'b', keep: true }] },
      { list: [{ k: 'A' }] },
    );
    expect(merged).toEqual({
      list: [{ k: 'A', keep: true }, { k: 'b', keep: true }],
    });
  });

  it('does not mutate its inputs', () => {
    const base: Json = { a: { x: 1 } };
    deepMerge(base, { a: { x: 2 } });
    expect(base).toEqual({ a: { x: 1 } });
  });
});

describe('merge-onto-current-document round-trip', () => {
  it('editing one field decodes to a document that keeps everything else', async () => {
    const base = (await Effect.runPromise(encode(defaultContent))) as Json;

    // Edit only the 2026 theme name (en) and accent colour.
    const overrides = assembleOverrides(
      entries({
        'conferences.2.themeName.en': 'Speak Up',
        'conferences.2.accentColor': '#123456',
      }),
    );
    const merged = deepMerge(base, overrides);
    const decoded = await Effect.runPromise(decode(merged));

    // The edited fields changed…
    expect(decoded.conferences[2]?.themeName.en).toBe('Speak Up');
    expect(decoded.conferences[2]?.accentColor).toBe('#123456');
    // …and everything else (deep bios, the 2024 speakers, the team) survived.
    expect(decoded.conferences[0]?.speakers.length).toBe(
      defaultContent.conferences[0]?.speakers.length,
    );
    expect(decoded.team).toEqual(defaultContent.team);
    expect(decoded.conferences[2]?.themeName.fr).toBe(
      defaultContent.conferences[2]?.themeName.fr,
    );
  });

  it('a bad edit (non-hex colour) is rejected by the decode boundary', async () => {
    const base = (await Effect.runPromise(encode(defaultContent))) as Json;
    const merged = deepMerge(
      base,
      assembleOverrides(entries({ 'conferences.0.accentColor': 'not-a-colour' })),
    );
    const exit = await Effect.runPromise(Effect.exit(decode(merged)));
    expect(exit._tag).toBe('Failure');
  });
});

describe('setAtPath', () => {
  it('sets a deep leaf on a clone without mutating the original', () => {
    const doc: Json = { conferences: [{ hero: { desktop: { key: { en: 'old' } } } }] };
    const next = setAtPath(doc, 'conferences.0.hero.desktop.key.en', 'images/new.png');
    expect(next).toEqual({
      conferences: [{ hero: { desktop: { key: { en: 'images/new.png' } } } }],
    });
    expect(doc).toEqual({
      conferences: [{ hero: { desktop: { key: { en: 'old' } } } }],
    });
  });
});

describe('image upload helpers', () => {
  it('recognises an upload intent and recovers its target path', () => {
    expect(imageUploadTarget('upload:team.0.photo.key')).toBe('team.0.photo.key');
    expect(imageUploadTarget('save-draft')).toBeNull();
    expect(imageUploadTarget('upload:')).toBeNull();
  });

  it('accepts only image content-types', () => {
    expect(isAcceptedImageType('image/png')).toBe(true);
    expect(isAcceptedImageType('image/JPEG')).toBe(true);
    expect(isAcceptedImageType('application/pdf')).toBe(false);
    expect(isAcceptedImageType('text/html')).toBe(false);
  });

  it('builds a namespaced, extension-correct, collision-free upload key', () => {
    const key = uploadedImageKey('team.0.photo.key', 'image/png', 1_700_000_000_000);
    expect(key).toBe('images/uploads/team-0-photo-key-1700000000000.png');
    expect(extensionForType('image/webp')).toBe('webp');
    // A second upload at a later instant gets a distinct key.
    const later = uploadedImageKey('team.0.photo.key', 'image/png', 1_700_000_000_001);
    expect(later).not.toBe(key);
  });
});

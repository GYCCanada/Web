import { describe, expect, it, test } from 'effect-bun-test';
import { Effect, Schema } from 'effect';

import {
  assembleOverrides,
  deepMerge,
  extensionForType,
  imageUploadTarget,
  isAcceptedImageType,
  normalizeFaqAnswers,
  setAtPath,
  uploadedImageKey,
  type Json,
} from './admin-form';
import { defaultContent } from './defaults';
import { SiteContent, newListItemId } from './schema';
import { DraftFaqPage, FaqPage } from './pages/schema';

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
  test('parses identity-keyed form names into a nested object tree', () => {
    // List items and conferences are named by their stable identity segment
    // (ADR 0006): `conferences.<slug>.…`, `team.<id>.…`. The assembled override
    // is therefore a pure object tree keyed by identity — never a sparse,
    // position-indexed array — which `deepMerge` reconciles against the base's
    // arrays by matching `slug` / `id`.
    const result = assembleOverrides(
      entries({
        'conferences./2024.themeName.en': 'New Title',
        'team.team-member-id-000001.name': 'Jane Doe',
        intent: 'save-draft',
        _array: 'ignored',
      }),
    );
    expect(result).toEqual({
      conferences: { '/2024': { themeName: { en: 'New Title' } } },
      team: { 'team-member-id-000001': { name: 'Jane Doe' } },
    });
  });

  test('coerces bible chapter/verse leaves to numbers', () => {
    const result = assembleOverrides(
      entries({
        'conferences./2024.bible.chapter': '12',
        'conferences./2024.bible.verse': '3',
      }),
    ) as { conferences: { '/2024': { bible: { chapter: number; verse: number } } } };
    expect(result.conferences['/2024']?.bible.chapter).toBe(12);
    expect(result.conferences['/2024']?.bible.verse).toBe(3);
  });
});

describe('normalizeFaqAnswers', () => {
  test('rewrites a both-locales answer leaf to a single text-token RichText', () => {
    // The FAQ answer input posts `items.<id>.answer.en/.fr` — a plain bilingual
    // object. The normalizer converts it to the encoded one-`text`-token RichText
    // ARRAY the `FaqPage` schema decodes, so `deepMerge` replaces the base array
    // wholesale (array base + array override) and the filled answer lands.
    const result = normalizeFaqAnswers(
      assembleOverrides(
        entries({
          'items.faq-item-id-000001.question.en': 'Q?',
          'items.faq-item-id-000001.question.fr': 'Q ?',
          'items.faq-item-id-000001.answer.en': 'An answer.',
          'items.faq-item-id-000001.answer.fr': 'Une réponse.',
        }),
      ),
    );
    expect(result).toEqual({
      items: {
        'faq-item-id-000001': {
          question: { en: 'Q?', fr: 'Q ?' },
          answer: [
            { _tag: 'text', value: { en: 'An answer.', fr: 'Une réponse.' } },
          ],
        },
      },
    });
  });

  test('drops a half-filled (one-locale) answer so the draft saves but publish stays blocked', () => {
    // A single `text` token's `value` is the strict both-locales `Text`; emitting it
    // from `{ en: 'x', fr: '' }` would be rejected at DRAFT save, inconsistent with
    // every other half-typed field. The normalizer drops the answer entirely instead
    // — it stays ABSENT (draft-valid, publish-invalid per ADR 0006).
    const enOnly = normalizeFaqAnswers(
      assembleOverrides(
        entries({
          'items.faq-item-id-000001.answer.en': 'Only EN',
          'items.faq-item-id-000001.answer.fr': '',
        }),
      ),
    ) as { items: { 'faq-item-id-000001': Record<string, unknown> } };
    expect('answer' in enOnly.items['faq-item-id-000001']).toBe(false);

    const empty = normalizeFaqAnswers(
      assembleOverrides(
        entries({
          'items.faq-item-id-000001.answer.en': '   ',
          'items.faq-item-id-000001.answer.fr': '',
        }),
      ),
    ) as { items: { 'faq-item-id-000001': Record<string, unknown> } };
    expect('answer' in empty.items['faq-item-id-000001']).toBe(false);
  });

  test('leaves a non-FAQ override (no items) and array answers untouched', () => {
    const give = normalizeFaqAnswers({
      directions: { 'list-id': { text: { en: 'x', fr: 'y' } } },
    });
    expect(give).toEqual({
      directions: { 'list-id': { text: { en: 'x', fr: 'y' } } },
    });
  });

  it.effect(
    'completes add → fill → publish: the merged+normalized FAQ override decodes draft AND strict',
    () =>
      Effect.gen(function* () {
        // Prove the ROUTE/UI path (not the service path): a freshly-added item is an
        // id-only stub; the form fills a plain bilingual answer; the normalized
        // override merges onto the encoded base and decodes through BOTH the laxer
        // draft schema and the strict publish schema (publish-valid).
        const id = newListItemId();
        const base: Json = { title: { en: 'FAQ', fr: 'FAQ' }, items: [{ id }] };
        const override = normalizeFaqAnswers(
          assembleOverrides(
            entries({
              [`items.${id}.question.en`]: 'New question?',
              [`items.${id}.question.fr`]: 'Nouvelle question ?',
              [`items.${id}.answer.en`]: 'An answer.',
              [`items.${id}.answer.fr`]: 'Une réponse.',
            }),
          ),
        );
        const merged = deepMerge(base, override);

        const draft = yield* Schema.decodeUnknownEffect(DraftFaqPage)(merged);
        const strict = yield* Schema.decodeUnknownEffect(FaqPage)(merged);
        expect(draft.items[0]?.question?.en).toBe('New question?');
        expect(strict.items[0]?.answer[0]).toEqual({
          _tag: 'text',
          value: { en: 'An answer.', fr: 'Une réponse.' },
        });
      }),
  );

  it.effect(
    'a stub with an absent/half-filled answer is draft-valid but publish-invalid',
    () =>
      Effect.gen(function* () {
        const id = newListItemId();
        const base: Json = { title: { en: 'FAQ', fr: 'FAQ' }, items: [{ id }] };
        // Question filled, answer left EN-only → normalizer drops the answer.
        const override = normalizeFaqAnswers(
          assembleOverrides(
            entries({
              [`items.${id}.question.en`]: 'Q?',
              [`items.${id}.question.fr`]: 'Q ?',
              [`items.${id}.answer.en`]: 'Only EN',
              [`items.${id}.answer.fr`]: '',
            }),
          ),
        );
        const merged = deepMerge(base, override);
        // Draft tolerates the absent answer …
        yield* Schema.decodeUnknownEffect(DraftFaqPage)(merged);
        // … publish rejects it (answer required by `FaqPage`).
        const publishExit = yield* Effect.exit(
          Schema.decodeUnknownEffect(FaqPage)(merged),
        );
        expect(publishExit._tag).toBe('Failure');
      }),
  );
});

describe('deepMerge', () => {
  test('overlays a leaf without dropping sibling keys', () => {
    const merged = deepMerge(
      { a: { x: 1, y: 2 }, b: 3 },
      { a: { x: 9 } },
    );
    expect(merged).toEqual({ a: { x: 9, y: 2 }, b: 3 });
  });

  test('merges an array base by item identity, not by position', () => {
    // The override is an identity-MAP (keyed by `id`), so a base array merges by
    // matching `id` — never by index. An item the override does not name keeps
    // every field verbatim; the order of `base` is preserved (a shifted position
    // can never land an edit on the wrong item — ADR 0006).
    const merged = deepMerge(
      { list: [{ id: 'a', k: 'a', keep: true }, { id: 'b', k: 'b', keep: true }] },
      { list: { a: { k: 'A' } } },
    );
    expect(merged).toEqual({
      list: [{ id: 'a', k: 'A', keep: true }, { id: 'b', k: 'b', keep: true }],
    });
  });

  test('an override id matching no base item is ignored (adds are applyListEdit, not a field merge)', () => {
    const merged = deepMerge(
      { list: [{ id: 'a', k: 'a' }] },
      { list: { z: { k: 'Z' } } },
    );
    expect(merged).toEqual({ list: [{ id: 'a', k: 'a' }] });
  });

  test('matches a conference base item by its slug identity', () => {
    const merged = deepMerge(
      { conferences: [{ slug: '/2024', t: 'old' }, { slug: '/2026', t: 'keep' }] },
      { conferences: { '/2024': { t: 'new' } } },
    );
    expect(merged).toEqual({
      conferences: [{ slug: '/2024', t: 'new' }, { slug: '/2026', t: 'keep' }],
    });
  });

  test('an edit lands on its id even when the item moved position (no index drift)', () => {
    // The override names item `b`; `b` sits at index 0 here. An index-aligned
    // merge would have edited index 0 expecting the FIRST-declared item — the
    // exact corruption ADR 0006 retires. Identity merge edits `b` wherever it is.
    const merged = deepMerge(
      { list: [{ id: 'b', v: 'old-b' }, { id: 'a', v: 'keep-a' }] },
      { list: { b: { v: 'new-b' } } },
    );
    expect(merged).toEqual({
      list: [{ id: 'b', v: 'new-b' }, { id: 'a', v: 'keep-a' }],
    });
  });

  test('does not mutate its inputs', () => {
    const base: Json = { a: { x: 1 } };
    deepMerge(base, { a: { x: 2 } });
    expect(base).toEqual({ a: { x: 1 } });
  });
});

describe('merge-onto-current-document round-trip', () => {
  it.effect('editing one field decodes to a document that keeps everything else', () =>
    Effect.gen(function* () {
      const base = (yield* encode(defaultContent)) as Json;

      // Edit only the 2026 theme name (en) and accent colour — addressed by the
      // conference's `slug` identity, not its array position (ADR 0006).
      const overrides = assembleOverrides(
        entries({
          'conferences./2026.themeName.en': 'Speak Up',
          'conferences./2026.accentColor': '#123456',
        }),
      );
      const merged = deepMerge(base, overrides);
      const decoded = yield* decode(merged);

      // The edited fields changed… (`accentColor` is the branded `HexColour`;
      // widen to its base string for the value assertion).
      expect(decoded.conferences[2]?.themeName.en).toBe('Speak Up');
      expect(String(decoded.conferences[2]?.accentColor)).toBe('#123456');
      // …and everything else (deep bios, the 2024 speakers, the team) survived.
      expect(decoded.conferences[0]?.speakers.length).toBe(
        defaultContent.conferences[0]?.speakers.length,
      );
      expect(decoded.team).toEqual(defaultContent.team);
      expect(decoded.conferences[2]?.themeName.fr).toBe(
        defaultContent.conferences[2]?.themeName.fr,
      );
    }));

  it.effect('a bad edit (non-hex colour) is rejected by the decode boundary', () =>
    Effect.gen(function* () {
      const base = (yield* encode(defaultContent)) as Json;
      const merged = deepMerge(
        base,
        assembleOverrides(entries({ 'conferences./2024.accentColor': 'not-a-colour' })),
      );
      const exit = yield* Effect.exit(decode(merged));
      expect(exit._tag).toBe('Failure');
    }));
});

describe('setAtPath', () => {
  test('sets a deep leaf by item identity on a clone without mutating the original', () => {
    // `setAtPath` navigates into the `conferences` array by matching the `/2024`
    // segment against each item's `slug` (ADR 0006), never by array index — so a
    // reordered document still rewrites the right item's key.
    const doc: Json = {
      conferences: [
        { slug: '/2024', hero: { desktop: { key: { en: 'old' } } } },
        { slug: '/2026', hero: { desktop: { key: { en: 'untouched' } } } },
      ],
    };
    const next = setAtPath(
      doc,
      'conferences./2024.hero.desktop.key.en',
      'images/new.png',
    );
    expect(next).toEqual({
      conferences: [
        { slug: '/2024', hero: { desktop: { key: { en: 'images/new.png' } } } },
        { slug: '/2026', hero: { desktop: { key: { en: 'untouched' } } } },
      ],
    });
    expect(doc).toEqual({
      conferences: [
        { slug: '/2024', hero: { desktop: { key: { en: 'old' } } } },
        { slug: '/2026', hero: { desktop: { key: { en: 'untouched' } } } },
      ],
    });
  });

  test('a list item is addressed by its id (team.<id>.photo.key)', () => {
    const doc: Json = {
      team: [
        { id: 'aaaaaaaaaaaaaaaaaaaaa', photo: { key: 'old.png' } },
        { id: 'bbbbbbbbbbbbbbbbbbbbb', photo: { key: 'keep.png' } },
      ],
    };
    const next = setAtPath(
      doc,
      'team.aaaaaaaaaaaaaaaaaaaaa.photo.key',
      'images/uploaded.png',
    );
    expect(next).toEqual({
      team: [
        { id: 'aaaaaaaaaaaaaaaaaaaaa', photo: { key: 'images/uploaded.png' } },
        { id: 'bbbbbbbbbbbbbbbbbbbbb', photo: { key: 'keep.png' } },
      ],
    });
  });
});

describe('image upload helpers', () => {
  test('recognises an upload intent and recovers its target path', () => {
    expect(imageUploadTarget('upload:team.team-member-id-1.photo.key')).toBe(
      'team.team-member-id-1.photo.key',
    );
    expect(imageUploadTarget('save-draft')).toBeNull();
    expect(imageUploadTarget('upload:')).toBeNull();
  });

  test('accepts only image content-types', () => {
    expect(isAcceptedImageType('image/png')).toBe(true);
    expect(isAcceptedImageType('image/JPEG')).toBe(true);
    expect(isAcceptedImageType('application/pdf')).toBe(false);
    expect(isAcceptedImageType('text/html')).toBe(false);
  });

  test('builds a namespaced, extension-correct, collision-free upload key', () => {
    const key = uploadedImageKey('team.0.photo.key', 'image/png', 1_700_000_000_000);
    expect(String(key)).toBe('images/uploads/team-0-photo-key-1700000000000.png');
    expect(extensionForType('image/webp')).toBe('webp');
    // A second upload at a later instant gets a distinct key.
    const later = uploadedImageKey('team.0.photo.key', 'image/png', 1_700_000_000_001);
    expect(later).not.toBe(key);
  });
});

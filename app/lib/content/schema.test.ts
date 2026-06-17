import { describe, expect, it, test } from 'effect-bun-test';
import { Effect, Schema } from 'effect';

import { defaultContent } from './defaults';
import {
  AssetKey,
  ConferenceSlug,
  DateRange,
  DraftSiteContent,
  ExternalHttpsUrl,
  GoogleMapsEmbedUrl,
  HexColour,
  IsoDate,
  ListItemId,
  newListItemId,
  SiteContent,
} from './schema';
import type {
  AssetKey as AssetKeyType,
  ConferenceSlug as ConferenceSlugType,
  HexColour as HexColourType,
  IsoDate as IsoDateType,
  ListItemId as ListItemIdType,
} from './schema';

/**
 * The encoded form of `SiteContent` IS the JSON stored at `content/site.json`,
 * so the bundled defaults must survive a full `encode → JSON → decode` trip with
 * no loss (`prove-it-works`). This pins both the schema and the transcription:
 * an accidental shape change or a non-round-tripping field (e.g. an `Option`
 * that does not decode back to the same value) fails here.
 */
const codec = Schema.fromJsonString(SiteContent);
const encode = Schema.encodeUnknownEffect(codec);
const decode = Schema.decodeUnknownEffect(codec);

/**
 * `typeof JSON.parse(json)` — a plain (non-Effect) sanity check that the encoded
 * string is valid JSON for an object. Kept outside the Effect context (the
 * project's lint prefers Schema codecs to raw `JSON` *inside* effects).
 */
const parsedType = (json: string): string => typeof JSON.parse(json);

describe('SiteContent round-trip', () => {
  it.effect('encodes the defaults to JSON and decodes back to a deep-equal value', () =>
    Effect.gen(function* () {
      const restored = yield* encode(defaultContent).pipe(Effect.flatMap(decode));

      expect(restored).toEqual(defaultContent);
    }));

  it.effect('produces a string the defaults can be recovered from', () =>
    Effect.gen(function* () {
      const json = yield* encode(defaultContent);

      expect(typeof json).toBe('string');
      // Sanity: the JSON parses and is an object (not e.g. a thrown error string).
      expect(parsedType(json)).toBe('object');
    }));
});

const isValidAssetKey = (key: string): boolean =>
  Schema.decodeUnknownResult(AssetKey)(key)._tag === 'Success';

describe('AssetKey validation', () => {
  test('accepts plain bucket-relative keys', () => {
    for (const key of [
      '2024/speakers/matt.png',
      'team/elijah.jpg',
      'content/site.json',
      'a',
      'images/2026/en/hero-desktop.png',
    ]) {
      expect(isValidAssetKey(key)).toBe(true);
    }
  });

  test('rejects empty, absolute, scheme, and traversal keys', () => {
    for (const key of [
      '', // empty
      '/2024/hero.png', // leading slash
      'http://example.com/x.png', // URL scheme
      'data:image/png;base64,AAAA', // data scheme
      '../secret.json', // parent traversal
      'a/../b', // embedded traversal
      'a//b', // empty segment / double slash
      'a/./b', // current-dir segment
      'a/', // trailing slash → empty segment
    ]) {
      expect(isValidAssetKey(key)).toBe(false);
    }
  });

  test('rejects backslash and percent-encoded traversal forms (boundary-discipline)', () => {
    // The validator IS the watertight boundary: C5 serves these keys via
    // `GET /images/*`, where percent-decoding can turn `%2e%2e` back into `..`.
    // Splitting on `/` alone would let these slip through, so the filter forbids
    // backslashes and percent-encoding outright.
    for (const key of [
      'a\\..\\b', // backslash traversal
      '..\\secret', // leading backslash traversal
      'a/%2e%2e/b', // percent-encoded `..` segment
      '%2e%2e/secret', // percent-encoded leading `..`
      'a/..%2fb', // percent-encoded `/` after a `..`
      'images/%2Fetc/passwd', // percent-encoded `/`
      '%2f', // bare percent-encoded slash
    ]) {
      expect(isValidAssetKey(key)).toBe(false);
    }
  });
});

const isValidIsoDate = (value: string): boolean =>
  Schema.decodeUnknownResult(IsoDate)(value)._tag === 'Success';

describe('IsoDate validation', () => {
  test('accepts real calendar dates, including a leap-year Feb 29', () => {
    for (const value of [
      '2026-06-09',
      '2024-02-29', // 2024 is a leap year
      '2025-12-31',
      '2026-01-01',
    ]) {
      expect(isValidIsoDate(value)).toBe(true);
    }
  });

  test('rejects malformed shapes and impossible calendar dates', () => {
    for (const value of [
      '', // empty
      '2026-6-9', // not zero-padded
      '2026/06/09', // wrong separator
      '2026-99-99', // impossible month + day
      '2026-13-01', // month out of range
      '2026-02-31', // day out of range for February
      '2026-02-29', // 2026 is not a leap year
      '2026-04-31', // April has 30 days
      '2026-00-10', // month 0
      '2026-06-00', // day 0
    ]) {
      expect(isValidIsoDate(value)).toBe(false);
    }
  });
});

const isValidDateRange = (range: { start: string; end: string }): boolean =>
  Schema.decodeUnknownResult(DateRange)(range)._tag === 'Success';

describe('DateRange ordering', () => {
  test('accepts start before or equal to end', () => {
    expect(isValidDateRange({ start: '2026-06-09', end: '2026-06-10' })).toBe(
      true,
    );
    expect(isValidDateRange({ start: '2026-06-09', end: '2026-06-09' })).toBe(
      true,
    );
  });

  test('rejects an inverted range (start after end)', () => {
    expect(isValidDateRange({ start: '2026-06-10', end: '2026-06-09' })).toBe(
      false,
    );
    expect(isValidDateRange({ start: '2027-01-01', end: '2026-12-31' })).toBe(
      false,
    );
  });
});

const isValidSlug = (value: string): boolean =>
  Schema.decodeUnknownResult(ConferenceSlug)(value)._tag === 'Success';

describe('ConferenceSlug validation', () => {
  test('accepts a `/YYYY` slug', () => {
    for (const value of ['/2024', '/2025', '/2026', '/0001']) {
      expect(isValidSlug(value)).toBe(true);
    }
  });

  test('rejects anything that is not a `/YYYY` slug', () => {
    for (const value of [
      '', // empty
      '2026', // missing leading slash
      '/26', // too few digits
      '/20260', // too many digits
      '/2026/', // trailing slash
      'speak', // not a slug at all
    ]) {
      expect(isValidSlug(value)).toBe(false);
    }
  });
});

const isValidExternalHttpsUrl = (value: string): boolean =>
  Schema.decodeUnknownResult(ExternalHttpsUrl)(value)._tag === 'Success';

describe('ExternalHttpsUrl validation (per-component XSS boundary)', () => {
  test('accepts https URLs without embedded credentials', () => {
    for (const value of [
      'https://gyccanada.regfox.com/gyc-canada-2026-speak',
      'https://docs.google.com/document/d/abc/pub',
      'https://example.com',
      'https://example.com/path?q=1#frag',
    ]) {
      expect(isValidExternalHttpsUrl(value)).toBe(true);
    }
  });

  test('rejects non-https protocols, credentialed URLs, and non-URLs', () => {
    for (const value of [
      '', // empty
      'http://example.com/x', // http: not https:
      'javascript:alert(1)', // XSS scheme
      'data:text/html,<script>alert(1)</script>', // data: scheme
      'file:///etc/passwd', // file: scheme
      'ftp://example.com/x', // ftp: scheme
      'https://user:pass@example.com/', // embedded credentials
      'https://user@example.com/', // embedded username
      '/relative/path', // not an absolute URL
      'example.com', // no scheme
      'not a url at all',
    ]) {
      expect(isValidExternalHttpsUrl(value)).toBe(false);
    }
  });
});

const isValidGoogleMapsEmbedUrl = (value: string): boolean =>
  Schema.decodeUnknownResult(GoogleMapsEmbedUrl)(value)._tag === 'Success';

describe('GoogleMapsEmbedUrl validation (host + path, NOT origin)', () => {
  test('accepts a real Google Maps embed URL', () => {
    expect(
      isValidGoogleMapsEmbedUrl(
        'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2570.5',
      ),
    ).toBe(true);
    expect(
      isValidGoogleMapsEmbedUrl('https://www.google.com/maps/embed/v1/place'),
    ).toBe(true);
  });

  test('rejects a non-embed Google path (origin check would WRONGLY admit this)', () => {
    // The defining case: an `origin` test excludes the path, so it would admit
    // `https://www.google.com/anything`. The host+path filter rejects it.
    for (const value of [
      'https://www.google.com/anything',
      'https://www.google.com/', // bare host, no embed path
      'https://www.google.com/search?q=evil',
      'https://www.google.com/maps', // /maps but not /maps/embed
    ]) {
      expect(isValidGoogleMapsEmbedUrl(value)).toBe(false);
    }
  });

  test('rejects non-google hosts, non-https, and credentialed URLs', () => {
    for (const value of [
      'https://evil.com/maps/embed?pb=x', // wrong host
      'https://maps.google.com/maps/embed', // wrong host (not www.google.com)
      'https://www.google.com.evil.com/maps/embed', // host spoof
      'http://www.google.com/maps/embed', // http: not https:
      'https://user:pass@www.google.com/maps/embed', // embedded credentials
      'javascript:alert(1)//www.google.com/maps/embed',
      '',
    ]) {
      expect(isValidGoogleMapsEmbedUrl(value)).toBe(false);
    }
  });
});

const isValidListItemId = (value: string): boolean =>
  Schema.decodeUnknownResult(ListItemId)(value)._tag === 'Success';

describe('ListItemId validation', () => {
  test('accepts a nanoid (21 chars from the URL-safe alphabet)', () => {
    for (const value of [
      '-3YbWuMRYEEr5Pd-MLdvP',
      'fk_vA5xNiXblPj040_K4v',
      'YOQ7GeACwaTCKjY6y3HAV',
      'aaaaaaaaaaaaaaaaaaaaa', // 21 plain chars
      '___-------___---___--', // 21 underscore/hyphen chars (URL-safe)
    ]) {
      expect(isValidListItemId(value)).toBe(true);
    }
  });

  test('rejects wrong length, the wrong alphabet, and non-id smuggle attempts', () => {
    for (const value of [
      '', // empty
      'tooshort', // < 21
      'aaaaaaaaaaaaaaaaaaaaaa', // 22 chars
      'aaaaaaaaaaaaaaaaaaaa.', // a dot (would break a `speakers.<id>.name` path)
      'aaaaaaaaaaaaaaaaaaaa/', // a slash
      'aaaaaaaaaaaaaaaaaaaa ', // trailing space
      'aaaaaaaaaaaaaaaaaaaa!', // punctuation outside the alphabet
      'aaaaaaaaaa aaaaaaaaaa', // embedded space
    ]) {
      expect(isValidListItemId(value)).toBe(false);
    }
  });

  test('newListItemId mints a fresh, schema-valid, unique id each call', () => {
    const a = newListItemId();
    const b = newListItemId();
    expect(isValidListItemId(String(a))).toBe(true);
    expect(isValidListItemId(String(b))).toBe(true);
    expect(String(a)).not.toBe(String(b));
  });
});

/**
 * Branding is encode/decode-transparent — the round-trip above proves the values
 * still pass through losslessly — but it makes the validation guarantee
 * load-bearing past the decoder: a value only earns the brand by crossing the
 * schema (`make-impossible-states-unrepresentable`, `boundary-discipline`). The
 * decode-rejection cases above (`AssetKey`, `IsoDate`, `HexColour`,
 * `ConferenceSlug`) already prove a bad value never produces a branded value;
 * these checks pin the *type-level* half of the guarantee so a future change that
 * silently drops a brand fails the typecheck (this whole block is a compile-time
 * assertion — the `@ts-expect-error` lines fail `tsc` the moment a raw `string`
 * becomes assignable to a brand again).
 */
describe('branded primitives carry their nominal brand', () => {
  test('decode/make produce a branded value, and a raw string is not assignable', () => {
    // Decoding yields the branded type, assignable to its own brand…
    const key: AssetKeyType = AssetKey.make('2026/en/hero.png');
    const date: IsoDateType = IsoDate.make('2026-06-10');
    const colour: HexColourType = HexColour.make('#D4A24E');
    const slug: ConferenceSlugType = ConferenceSlug.make('/2026');
    const itemId: ListItemIdType = ListItemId.make('YOQ7GeACwaTCKjY6y3HAV');

    // …and erase to their base string at runtime (brands are type-only).
    expect(String(key)).toBe('2026/en/hero.png');
    expect(String(date)).toBe('2026-06-10');
    expect(String(colour)).toBe('#D4A24E');
    expect(String(slug)).toBe('/2026');
    expect(String(itemId)).toBe('YOQ7GeACwaTCKjY6y3HAV');

    // A raw `string` must NOT be assignable where a brand is required: each line
    // is a deliberate type error guarded by `@ts-expect-error`, so the typecheck
    // fails if branding is ever lost (`prove-it-works` at the type level).
    // @ts-expect-error a raw string is not an AssetKey until it crosses the decoder
    const notKey: AssetKeyType = '2026/en/hero.png';
    // @ts-expect-error a raw string is not an IsoDate until it crosses the decoder
    const notDate: IsoDateType = '2026-06-10';
    // @ts-expect-error a raw string is not a HexColour until it crosses the decoder
    const notColour: HexColourType = '#D4A24E';
    // @ts-expect-error a raw string is not a ConferenceSlug until it crosses the decoder
    const notSlug: ConferenceSlugType = '/2026';
    // @ts-expect-error a raw string is not a ListItemId until it crosses the decoder
    const notItemId: ListItemIdType = 'YOQ7GeACwaTCKjY6y3HAV';

    // Reference the locals so they are not flagged as unused; their string
    // values are intentionally identical to the branded ones above (widen to
    // base string so the matcher compares plain strings).
    expect([notKey, notDate, notColour, notSlug, notItemId].map(String)).toEqual([
      '2026/en/hero.png',
      '2026-06-10',
      '#D4A24E',
      '/2026',
      'YOQ7GeACwaTCKjY6y3HAV',
    ]);
  });
});

/**
 * `DraftSiteContent` (ADR 0006, registration-launch Branch 2) is the laxer
 * variant the `/admin` editor saves and reopens: a freshly-added list item is
 * draft-valid carrying only its `id`, while publish enforces the strict
 * `SiteContent`. These pin the two halves of that contract — a stub item decodes
 * as a draft but NOT as a publish, and a *present* malformed value (half a
 * bilingual locale) is rejected even by the draft (only *absence* is tolerated).
 */
const encodeStrict = Schema.encodeUnknownEffect(SiteContent);
const decodeDraft = Schema.decodeUnknownResult(DraftSiteContent);
const decodeStrict = Schema.decodeUnknownResult(SiteContent);

/**
 * The encoded defaults as a plain JSON object, with `extraSpeaker` appended to
 * the /2024 speakers. Typed `unknown`→record so a deliberately-partial /
 * malformed speaker (the cases under test) can be constructed without satisfying
 * the strict encoded `Speaker` shape.
 */
const withExtraSpeaker = (
  encoded: typeof SiteContent.Encoded,
  extraSpeaker: Record<string, unknown>,
): unknown => {
  const doc = encoded as unknown as {
    conferences: ReadonlyArray<{
      slug: string;
      speakers: readonly unknown[];
    }>;
  };
  return {
    ...doc,
    conferences: doc.conferences.map((c) =>
      c.slug === '/2024'
        ? { ...c, speakers: [...c.speakers, extraSpeaker] }
        : c,
    ),
  };
};

describe('DraftSiteContent (draft-lax / publish-strict)', () => {
  it.effect('a freshly-added stub item (id only) decodes as a DRAFT', () =>
    Effect.gen(function* () {
      const encoded = yield* encodeStrict(defaultContent);
      const draft = withExtraSpeaker(encoded, { id: String(newListItemId()) });
      expect(decodeDraft(draft)._tag).toBe('Success');
    }));

  it.effect('the same stub item is REJECTED by the strict publish schema', () =>
    Effect.gen(function* () {
      const encoded = yield* encodeStrict(defaultContent);
      const draft = withExtraSpeaker(encoded, { id: String(newListItemId()) });
      // The added speaker has no required `name`/`activity`/`bio`/`photo` —
      // publish (strict `SiteContent`) rejects it (ADR 0006: an empty required
      // field blocks publish, not draft save).
      expect(decodeStrict(draft)._tag).toBe('Failure');
    }));

  it.effect('a complete document satisfies BOTH the draft and the strict schema', () =>
    Effect.gen(function* () {
      const encoded = yield* encodeStrict(defaultContent);
      expect(decodeDraft(encoded)._tag).toBe('Success');
      expect(decodeStrict(encoded)._tag).toBe('Success');
    }));

  it.effect('a half-filled bilingual field IS draft-valid (in-progress edit), but publish-invalid', () =>
    Effect.gen(function* () {
      const encoded = yield* encodeStrict(defaultContent);
      // A present `name` with an empty FR locale is an *in-progress* edit — the
      // admin typed EN, not yet FR. The draft tolerates it (ADR 0006: an
      // incomplete field blocks publish, not save) but publish (strict `Text`,
      // both locales non-empty) rejects it.
      const inProgress = withExtraSpeaker(encoded, {
        id: String(newListItemId()),
        name: { en: 'Jane', fr: '' },
      });
      expect(decodeDraft(inProgress)._tag).toBe('Success');
      expect(decodeStrict(inProgress)._tag).toBe('Failure');
    }));

  it.effect('a present but MALFORMED leaf (a non-AssetKey image key) is rejected even as a draft', () =>
    Effect.gen(function* () {
      const encoded = yield* encodeStrict(defaultContent);
      // The draft tolerates *absence*, never a malformed *typed* value: a present
      // image `key` must still be a valid `AssetKey` (an upload always produces
      // one). A path-traversal key is rejected even in a draft
      // (`make-impossible-states-unrepresentable` holds for what IS set).
      const malformed = withExtraSpeaker(encoded, {
        id: String(newListItemId()),
        photo: { key: '../../etc/passwd' },
      });
      expect(decodeDraft(malformed)._tag).toBe('Failure');
    }));
});

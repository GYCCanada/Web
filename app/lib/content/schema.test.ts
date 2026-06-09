import { describe, expect, it } from 'bun:test';
import { Effect, Schema } from 'effect';

import { defaultContent } from './defaults';
import { AssetKey, DateRange, IsoDate, SiteContent } from './schema';

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

describe('SiteContent round-trip', () => {
  it('encodes the defaults to JSON and decodes back to a deep-equal value', async () => {
    const restored = await Effect.runPromise(
      encode(defaultContent).pipe(Effect.flatMap(decode)),
    );

    expect(restored).toEqual(defaultContent);
  });

  it('produces a string the defaults can be recovered from', async () => {
    const json = await Effect.runPromise(encode(defaultContent));

    expect(typeof json).toBe('string');
    // Sanity: the JSON parses and is an object (not e.g. a thrown error string).
    expect(typeof JSON.parse(json)).toBe('object');
  });
});

const isValidAssetKey = (key: string): boolean =>
  Schema.decodeUnknownResult(AssetKey)(key)._tag === 'Success';

describe('AssetKey validation', () => {
  it('accepts plain bucket-relative keys', () => {
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

  it('rejects empty, absolute, scheme, and traversal keys', () => {
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

  it('rejects backslash and percent-encoded traversal forms (boundary-discipline)', () => {
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
  it('accepts real calendar dates, including a leap-year Feb 29', () => {
    for (const value of [
      '2026-06-09',
      '2024-02-29', // 2024 is a leap year
      '2025-12-31',
      '2026-01-01',
    ]) {
      expect(isValidIsoDate(value)).toBe(true);
    }
  });

  it('rejects malformed shapes and impossible calendar dates', () => {
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
  it('accepts start before or equal to end', () => {
    expect(isValidDateRange({ start: '2026-06-09', end: '2026-06-10' })).toBe(
      true,
    );
    expect(isValidDateRange({ start: '2026-06-09', end: '2026-06-09' })).toBe(
      true,
    );
  });

  it('rejects an inverted range (start after end)', () => {
    expect(isValidDateRange({ start: '2026-06-10', end: '2026-06-09' })).toBe(
      false,
    );
    expect(isValidDateRange({ start: '2027-01-01', end: '2026-12-31' })).toBe(
      false,
    );
  });
});

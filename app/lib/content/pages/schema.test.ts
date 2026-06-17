import { describe, expect, it, test } from 'effect-bun-test';
import { Effect, Schema } from 'effect';

import {
  defaultAboutPage,
  defaultArchivePage,
  defaultContactForm,
  defaultContactPage,
  defaultFaqPage,
  defaultGivePage,
  defaultHomePage,
  defaultRegistrationForm,
  defaultVolunteerForm,
  defaultVolunteerPage,
} from './defaults';
import {
  AboutPage,
  ArchivePage,
  ContactPage,
  FaqPage,
  FormDefinition,
  GivePage,
  HomePage,
  LinkHref,
  RichText,
  RichTextNode,
  VolunteerPage,
} from './schema';

/**
 * Each per-Page schema's encoded form IS the JSON stored at its `content/pages/<page>.json`
 * object (ADR 0008), so every bundled default must survive a full
 * `encode → JSON → decode` round-trip with no loss (`prove-it-works`). This pins both the
 * schema and the transcription per page: a non-round-tripping field (a `RichText` token
 * that does not decode back, a brand that does not survive) fails here.
 */
const roundTrips = <A, I>(
  schema: Schema.Codec<A, I>,
  value: A,
): Effect.Effect<A, Schema.SchemaError> => {
  const codec = Schema.fromJsonString(schema);
  return Schema.encodeUnknownEffect(codec)(value).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(codec)),
  );
};

describe('per-page default round-trips', () => {
  const cases = [
    ['AboutPage', AboutPage, defaultAboutPage],
    ['FaqPage', FaqPage, defaultFaqPage],
    ['GivePage', GivePage, defaultGivePage],
    ['ContactPage', ContactPage, defaultContactPage],
    ['VolunteerPage', VolunteerPage, defaultVolunteerPage],
    ['ArchivePage', ArchivePage, defaultArchivePage],
    ['HomePage', HomePage, defaultHomePage],
  ] as const;

  for (const [name, schema, value] of cases) {
    it.effect(`${name} encodes to JSON and decodes back deep-equal`, () =>
      Effect.gen(function* () {
        const restored = yield* roundTrips(
          schema as Schema.Codec<unknown, unknown>,
          value,
        );
        expect(restored).toEqual(value);
      }));
  }
});

describe('FormDefinition placeholder', () => {
  const cases = [
    ['contact', defaultContactForm],
    ['volunteer', defaultVolunteerForm],
    ['registration', defaultRegistrationForm],
  ] as const;

  for (const [name, value] of cases) {
    it.effect(`${name} form definition round-trips`, () =>
      Effect.gen(function* () {
        const restored = yield* roundTrips(FormDefinition, value);
        expect(restored).toEqual(value);
      }));
  }

  test('an optional intro is representable and round-trips', () => {
    const withIntro = Schema.decodeUnknownSync(FormDefinition)({
      title: { en: 'Contact', fr: 'Contact' },
      intro: { en: 'Say hello', fr: 'Dites bonjour' },
    });
    expect(withIntro.intro).toBeDefined();
  });
});

const isValidLinkHref = (value: string): boolean =>
  Schema.decodeUnknownResult(LinkHref)(value)._tag === 'Success';

describe('LinkHref (closed: https + mailto only)', () => {
  test('accepts external https URLs and mailto recipients', () => {
    for (const href of [
      'https://gyccanada.org',
      'https://www.google.com/maps',
      'mailto:hello@gyccanada.org',
      'mailto:team@example.com?subject=Hi',
    ]) {
      expect(isValidLinkHref(href)).toBe(true);
    }
  });

  test('rejects javascript/data/http/relative/recipient-less hrefs (XSS boundary)', () => {
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://gyccanada.org', // not https
      '/about', // relative
      'gyccanada.org', // not absolute
      'mailto:', // no recipient
      'https://user:pass@evil.example/', // embedded credentials
    ]) {
      expect(isValidLinkHref(href)).toBe(false);
    }
  });
});

describe('RichText (closed inline-token model, never HTML)', () => {
  const mailto = Schema.decodeUnknownSync(LinkHref)('mailto:hi@gyccanada.org');
  it.effect('a text/bold/link token sequence round-trips losslessly', () =>
    Effect.gen(function* () {
      const value: RichText = [
        RichTextNode.cases.text.make({
          value: { en: 'Email us at ', fr: 'Écrivez-nous à ' },
        }),
        RichTextNode.cases.link.make({
          text: { en: 'us', fr: 'nous' },
          href: mailto,
        }),
        RichTextNode.cases.bold.make({
          value: { en: ' today.', fr: " aujourd'hui." },
        }),
      ];
      const restored = yield* roundTrips(RichText, value);
      expect(restored).toEqual(value);
    }));

  test('rejects an unknown token kind (the set is closed)', () => {
    const result = Schema.decodeUnknownResult(RichText)([
      { _tag: 'image', src: 'x.png' },
    ]);
    expect(result._tag).toBe('Failure');
  });

  test('rejects a link token carrying an unsafe href', () => {
    const result = Schema.decodeUnknownResult(RichText)([
      { _tag: 'link', text: { en: 'x', fr: 'x' }, href: 'javascript:alert(1)' },
    ]);
    expect(result._tag).toBe('Failure');
  });
});

describe('present-but-empty content is a hard decode error (skip != tolerance)', () => {
  test('a present FAQ item with a blank-locale question fails decode', () => {
    const result = Schema.decodeUnknownResult(FaqPage)({
      title: { en: 'FAQ', fr: 'FAQ' },
      items: [
        {
          id: 'a'.repeat(21),
          question: { en: '', fr: '' }, // blank required bilingual field
          answer: [{ _tag: 'text', value: { en: 'a', fr: 'a' } }],
        },
      ],
    });
    expect(result._tag).toBe('Failure');
  });

  test('a present text token with a blank-locale value fails decode', () => {
    const result = Schema.decodeUnknownResult(RichText)([
      { _tag: 'text', value: { en: '', fr: '' } },
    ]);
    expect(result._tag).toBe('Failure');
  });

  test('a Give page missing its required donateUrl fails decode', () => {
    const result = Schema.decodeUnknownResult(GivePage)({
      title: { en: 'Give', fr: 'Donner' },
      reason: { en: 'r', fr: 'r' },
      directions: [],
    });
    expect(result._tag).toBe('Failure');
  });

  test('duplicate list-item ids are rejected (id-keyed identity invariant)', () => {
    const dup = 'b'.repeat(21);
    const result = Schema.decodeUnknownResult(AboutPage)({
      title: { en: 'About', fr: 'À propos' },
      paragraphs: [
        { id: dup, text: { en: 'a', fr: 'a' } },
        { id: dup, text: { en: 'b', fr: 'b' } },
      ],
      disclaimer: { en: 'd', fr: 'd' },
      quotes: [],
    });
    expect(result._tag).toBe('Failure');
  });
});

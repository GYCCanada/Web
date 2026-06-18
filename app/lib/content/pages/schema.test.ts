import { describe, expect, it, test } from 'effect-bun-test';
import { Effect, Schema } from 'effect';

import {
  defaultAboutPage,
  defaultArchivePage,
  defaultContactPage,
  defaultFaqPage,
  defaultGivePage,
  defaultHomePage,
  defaultTeamPage,
  defaultVolunteerPage,
} from './defaults';
import {
  AboutPage,
  ArchivePage,
  ContactPage,
  DraftAboutPage,
  DraftArchivePage,
  DraftFaqPage,
  DraftGivePage,
  DraftTeamPage,
  FaqPage,
  GivePage,
  HomePage,
  LinkHref,
  RichText,
  RichTextNode,
  TeamPage,
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
    ['TeamPage', TeamPage, defaultTeamPage],
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

/**
 * The Team page carries a RichText title plus TWO optional `ImageRef` slots. These
 * pin the decode-safety contract the migration depends on:
 *   - a `team.json` WITHOUT either image still decodes (section-skip default), and
 *     WITH each present image round-trips losslessly (the present image carries a
 *     strict `{ key, alt }`);
 *   - a present image whose `key` is not a valid `AssetKey` (a leading-`/` path)
 *     is REJECTED — the strict `AssetKey` brand still gates a present slot;
 *   - a stored JSON missing BOTH optional image fields decodes (the
 *     required-field-on-an-already-published-doc gate: the fields are
 *     `optionalKey`, so adding them never breaks an extant object);
 *   - the DRAFT variant tolerates an uploaded `key` with NO alt yet (the
 *     upload-first / fill-alt-second flow), while strict publish still requires both.
 */
describe('TeamPage (RichText title + two optional ImageRef slots)', () => {
  const KEY = '2026/team/group.jpg';
  const baseEncoded = {
    title: [
      { _tag: 'text', value: { en: 'The people behind the ', fr: 'Les personnes derrière le ' } },
      { _tag: 'italic', value: { en: 'movement', fr: 'mouvement' } },
      { _tag: 'text', value: { en: '.', fr: '.' } },
    ],
    subtitle: { en: 'We are GYC Canada.', fr: 'Nous sommes GYC Canada.' },
    boardHeading: { en: 'Board of Directors', fr: 'Conseil d’administration' },
  };

  it.effect('round-trips WITHOUT either image (section-skip)', () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(TeamPage)(baseEncoded);
      const restored = yield* roundTrips(TeamPage, decoded);
      expect(restored).toEqual(decoded);
      expect(restored.groupPhoto).toBeUndefined();
      expect(restored.portrait).toBeUndefined();
    }));

  it.effect('round-trips WITH each present image (strict {key, alt})', () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(TeamPage)({
        ...baseEncoded,
        groupPhoto: { key: KEY, alt: { en: 'A group photo.', fr: 'Une photo de groupe.' } },
        portrait: { key: '2026/team/portrait.png', alt: { en: 'Logo.', fr: 'Logo.' } },
      });
      const restored = yield* roundTrips(TeamPage, decoded);
      expect(restored).toEqual(decoded);
      expect(String(restored.groupPhoto?.key)).toBe(KEY);
      expect(restored.portrait?.alt.fr).toBe('Logo.');
    }));

  test('a present image with a NON-AssetKey key (leading "/") fails decode', () => {
    const result = Schema.decodeUnknownResult(TeamPage)({
      ...baseEncoded,
      groupPhoto: { key: '/team/group.jpg', alt: { en: 'x', fr: 'x' } },
    });
    expect(result._tag).toBe('Failure');
  });

  test('a present image with a blank-locale alt fails decode (skip != half-filled)', () => {
    const result = Schema.decodeUnknownResult(TeamPage)({
      ...baseEncoded,
      groupPhoto: { key: KEY, alt: { en: '', fr: '' } },
    });
    expect(result._tag).toBe('Failure');
  });

  test('a stored team.json missing BOTH optional image fields decodes (decode-migration gate)', () => {
    // The exact required-field-on-a-published-doc trap: adding `groupPhoto` /
    // `portrait` must NOT break an object that predates them. `optionalKey` means
    // an object with neither field still decodes.
    const result = Schema.decodeUnknownResult(TeamPage)(baseEncoded);
    expect(result._tag).toBe('Success');
  });

  test('the DRAFT variant tolerates an uploaded key with NO alt; strict publish requires both', () => {
    const keyOnly = {
      ...baseEncoded,
      groupPhoto: { key: KEY }, // uploaded key, alt not yet typed
    };
    expect(Schema.decodeUnknownResult(DraftTeamPage)(keyOnly)._tag).toBe('Success');
    expect(Schema.decodeUnknownResult(TeamPage)(keyOnly)._tag).toBe('Failure');
  });

  test('the DRAFT variant still rejects a MALFORMED present key (not merely absent)', () => {
    const badKey = {
      ...baseEncoded,
      groupPhoto: { key: '/leading-slash.jpg' },
    };
    expect(Schema.decodeUnknownResult(DraftTeamPage)(badKey)._tag).toBe('Failure');
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
        RichTextNode.cases.italic.make({
          value: { en: ' * footnote', fr: ' * note' },
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

/**
 * The DRAFT page variants (Branch 5.5, ADR 0006) tolerate an id-only added list
 * item (settled #10) so "Add item" → auto-save works, while the STRICT page schema
 * still rejects the same incomplete item on publish. This proves the add-then-fill
 * loop: a freshly-added FAQ item / give-direction / About paragraph-or-quote /
 * Archive entry is draft-valid yet publish-invalid until its bilingual fields are
 * filled — section-skip is for *absence*, never half-filled content
 * (CONTEXT §Section skip).
 */
describe('draft page variants tolerate id-only adds; strict schema blocks publish', () => {
  const ID = 'd'.repeat(21);

  test('an id-only FAQ item is draft-valid but publish-invalid', () => {
    const base = { title: { en: 'FAQ', fr: 'FAQ' }, items: [{ id: ID }] };
    expect(Schema.decodeUnknownResult(DraftFaqPage)(base)._tag).toBe('Success');
    expect(Schema.decodeUnknownResult(FaqPage)(base)._tag).toBe('Failure');
  });

  test('an id-only give-direction is draft-valid but publish-invalid', () => {
    const base = {
      title: { en: 'Give', fr: 'Donner' },
      reason: { en: 'r', fr: 'r' },
      directions: [{ id: ID }],
      donateUrl: 'https://example.org/donate',
    };
    expect(Schema.decodeUnknownResult(DraftGivePage)(base)._tag).toBe('Success');
    expect(Schema.decodeUnknownResult(GivePage)(base)._tag).toBe('Failure');
  });

  test('an id-only About paragraph AND quote are draft-valid but publish-invalid', () => {
    const base = {
      title: { en: 'About', fr: 'À propos' },
      paragraphs: [{ id: ID }],
      disclaimer: { en: 'd', fr: 'd' },
      quotes: [{ id: 'e'.repeat(21) }],
    };
    expect(Schema.decodeUnknownResult(DraftAboutPage)(base)._tag).toBe('Success');
    expect(Schema.decodeUnknownResult(AboutPage)(base)._tag).toBe('Failure');
  });

  test('an id-only Archive entry is draft-valid but publish-invalid', () => {
    const base = { title: { en: 'Archive', fr: 'Archives' }, entries: [{ id: ID }] };
    expect(Schema.decodeUnknownResult(DraftArchivePage)(base)._tag).toBe('Success');
    expect(Schema.decodeUnknownResult(ArchivePage)(base)._tag).toBe('Failure');
  });

  test('the draft still rejects a MALFORMED present value (not merely absent)', () => {
    // A present donateUrl that is not https crosses the strict `ExternalHttpsUrl`
    // boundary even in the draft — the draft tolerates ABSENCE, never a malformed
    // value (`make-impossible-states-unrepresentable` still holds for what is set).
    const result = Schema.decodeUnknownResult(DraftGivePage)({
      title: { en: 'Give', fr: 'Donner' },
      reason: { en: 'r', fr: 'r' },
      directions: [],
      donateUrl: 'javascript:alert(1)',
    });
    expect(result._tag).toBe('Failure');
  });

  test('a fully-filled draft FAQ item publishes cleanly through the strict schema', () => {
    const filled = {
      title: { en: 'FAQ', fr: 'FAQ' },
      items: [
        {
          id: ID,
          question: { en: 'Q?', fr: 'Q ?' },
          answer: [{ _tag: 'text', value: { en: 'A.', fr: 'R.' } }],
        },
      ],
    };
    expect(Schema.decodeUnknownResult(DraftFaqPage)(filled)._tag).toBe('Success');
    expect(Schema.decodeUnknownResult(FaqPage)(filled)._tag).toBe('Success');
  });
});

/**
 * The per-page `enabled` flag (Feature C) is decode-safe via
 * `withDecodingDefaultKey(Effect.succeed(true))`: a stored `content/pages/<page>.json`
 * that PREDATES the flag (no `enabled` key) must still decode — to `enabled: true` —
 * so adding the field can never break an already-published doc (the
 * required-field-on-a-published-doc hazard the registration launch hit twice). An
 * explicit `enabled: false` round-trips encode→decode (the passthrough writes it
 * back, so a re-published object is self-describing). The flag lives on BOTH the
 * strict and the draft schema (no draft drift), covered across every page incl. team.
 */
describe('per-page enabled flag (decode-safe, default true)', () => {
  // Every page's strict schema, plus a minimal valid encoded body MISSING `enabled`.
  const strictCases = [
    ['AboutPage', AboutPage, { title: { en: 'A', fr: 'A' }, paragraphs: [], disclaimer: { en: 'd', fr: 'd' }, quotes: [] }],
    ['FaqPage', FaqPage, { title: { en: 'F', fr: 'F' }, items: [] }],
    ['GivePage', GivePage, { title: { en: 'G', fr: 'G' }, reason: { en: 'r', fr: 'r' }, directions: [], donateUrl: 'https://example.org/donate' }],
    ['ContactPage', ContactPage, { title: { en: 'C', fr: 'C' }, directions: [] }],
    ['VolunteerPage', VolunteerPage, { title: [], subtitle: { en: 's', fr: 's' }, directions: { en: 'd', fr: 'd' } }],
    ['ArchivePage', ArchivePage, { title: { en: 'Ar', fr: 'Ar' }, entries: [] }],
    ['HomePage', HomePage, {
      tagline: { en: 't', fr: 't' },
      mission: { readStoryLabel: { en: 'r', fr: 'r' } },
      join: { title: { en: 'j', fr: 'j' }, subtitle: { en: 's', fr: 's' }, donateLabel: { en: 'd', fr: 'd' }, volunteerLabel: { en: 'v', fr: 'v' } },
      newsletter: { title: { en: 'n', fr: 'n' }, subtitle: { en: 's', fr: 's' }, socials: { en: 'so', fr: 'so' } },
    }],
    ['TeamPage', TeamPage, { title: [], subtitle: { en: 's', fr: 's' }, boardHeading: { en: 'b', fr: 'b' } }],
  ] as const;

  for (const [name, schema, bodyNoEnabled] of strictCases) {
    test(`${name}: a stored doc WITHOUT enabled decodes to enabled:true (decode-migration gate)`, () => {
      const result = Schema.decodeUnknownResult(
        schema as Schema.Codec<{ readonly enabled: boolean }, unknown>,
      )(bodyNoEnabled);
      expect(result._tag).toBe('Success');
      if (result._tag === 'Success') {
        expect(result.success.enabled).toBe(true);
      }
    });

    it.effect(`${name}: enabled:false round-trips encode→decode`, () =>
      Effect.gen(function* () {
        const codec = schema as Schema.Codec<
          { readonly enabled: boolean },
          unknown
        >;
        const decoded = yield* Schema.decodeUnknownEffect(codec)({
          ...bodyNoEnabled,
          enabled: false,
        });
        expect(decoded.enabled).toBe(false);
        const roundtripped = yield* roundTrips(codec, decoded);
        expect(roundtripped.enabled).toBe(false);
      }));
  }

  // The DRAFT variants carry the same defaulted flag (no draft-schema drift).
  const draftCases = [
    ['DraftAboutPage', DraftAboutPage, { title: { en: 'A', fr: 'A' }, paragraphs: [], disclaimer: { en: 'd', fr: 'd' }, quotes: [] }],
    ['DraftFaqPage', DraftFaqPage, { title: { en: 'F', fr: 'F' }, items: [] }],
    ['DraftGivePage', DraftGivePage, { title: { en: 'G', fr: 'G' }, reason: { en: 'r', fr: 'r' }, directions: [], donateUrl: 'https://example.org/donate' }],
    ['DraftArchivePage', DraftArchivePage, { title: { en: 'Ar', fr: 'Ar' }, entries: [] }],
    ['DraftTeamPage', DraftTeamPage, { title: [], subtitle: { en: 's', fr: 's' }, boardHeading: { en: 'b', fr: 'b' } }],
  ] as const;

  for (const [name, schema, bodyNoEnabled] of draftCases) {
    test(`${name}: a draft doc WITHOUT enabled decodes to enabled:true`, () => {
      const result = Schema.decodeUnknownResult(
        schema as Schema.Codec<{ readonly enabled: boolean }, unknown>,
      )(bodyNoEnabled);
      expect(result._tag).toBe('Success');
      if (result._tag === 'Success') {
        expect(result.success.enabled).toBe(true);
      }
    });
  }

  test('the bundled defaultTeamPage ships enabled:false (hidden by data, not a code comment)', () => {
    expect(defaultTeamPage.enabled).toBe(false);
  });

  test('every other bundled default ships enabled:true', () => {
    expect(defaultAboutPage.enabled).toBe(true);
    expect(defaultFaqPage.enabled).toBe(true);
    expect(defaultGivePage.enabled).toBe(true);
    expect(defaultContactPage.enabled).toBe(true);
    expect(defaultVolunteerPage.enabled).toBe(true);
    expect(defaultArchivePage.enabled).toBe(true);
    expect(defaultHomePage.enabled).toBe(true);
  });
});

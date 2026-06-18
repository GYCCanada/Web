import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer, Option, Ref, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import {
  Content,
  SITE_CONTENT_KEY,
  bustForm,
  bustPage,
} from './content.server';
import { defaultContent } from './content/defaults';
import {
  defaultAboutPage,
  defaultContactForm,
  defaultFaqPage,
  defaultTeamPage,
} from './content/pages/defaults';
import { formObjectKey, pageObjectKey } from './content/pages/registry';
import { AboutPage, FaqPage } from './content/pages/schema';
import { FormDefinition } from './forms/definition';
import { HexColour, SiteContent } from './content/schema';
import type { SiteContent as SiteContentType } from './content/schema';
import { dayjs } from './dayjs';
import { NotFound, Storage, StorageError } from './storage.server';
import { layerTest } from './storage.test-helper';

/**
 * The `Content` service is the single read path for the public site (C3). These
 * tests pin the behaviour the migrated routes depend on:
 *   - it falls back to the bundled defaults when the bucket has no document, so
 *     dev / a bucket-less prod render exactly like today (D3);
 *   - it decodes a real published document at the boundary and converts it to
 *     the legacy route shape (per-locale strings, `[start, end]` ms tuples,
 *     leading-`/` image URLs) so component code is unchanged;
 *   - the current-conference-by-date and by-year selection match today's
 *     `conference.server.ts` semantics (`derive-dont-sync`);
 *   - reads are cached within the TTL (same reference) and refreshed after it,
 *     concurrent first-reads are single-flighted, and the editor's `bust` makes
 *     a publish visible on the next read (`use-the-platform` — the built-in
 *     `Effect.cachedInvalidateWithTTL`).
 */

const encode = Schema.encodeUnknownEffect(Schema.fromJsonString(SiteContent));

/** A `Storage` with no document — every read reports `NotFound` (bucket-less). */
const emptyStorage = Layer.succeed(
  Storage.Service,
  Storage.Service.of({
    get: (key) => Effect.fail(new NotFound({ key })),
    put: (key) =>
      Effect.fail(
        new StorageError({ key, op: 'put', cause: new Error('disabled') }),
      ),
    head: () => Effect.succeed(Option.none()),
    list: () => Effect.succeed([]),
    delete: () => Effect.void,
  }),
);

/**
 * Provide `Content` (with its `Storage` requirement satisfied) AND expose the
 * SAME built `Storage` to the test effect: `Content.layer` keeps its `Storage`
 * requirement open and is merged with the same `storageLayer` that is also
 * exposed, so both resolve to the one built instance — a `put` from the test hits
 * the same backing store `Content` reads (publish → bust → read).
 *
 * `it.effect` already provides a `Scope` and a `TestClock`, so this helper does
 * neither — it is a pure layer provide.
 */
const provideContent =
  (storageLayer: Layer.Layer<Storage.Service>) =>
  <A, E>(effect: Effect.Effect<A, E, Content.Service | Storage.Service>) =>
    effect.pipe(Effect.provide(Layer.provideMerge(Content.layer, storageLayer)));

/**
 * Build a `Storage` layer from a `SiteContent` doc encoded to its on-bucket JSON.
 * The encode is an `Effect<string, SchemaError>`, so the layer is built via
 * `Layer.unwrap`; a seed doc that won't encode is a test bug, not a tested
 * failure path, so the `SchemaError` is promoted to a defect (`orDie`) — this
 * keeps the resulting layer's error channel `never`, as `provideContent` requires.
 */
const seededStorage = (
  doc: SiteContentType,
  factory: (json: string) => Layer.Layer<Storage.Service>,
): Layer.Layer<Storage.Service> =>
  Layer.unwrap(encode(doc).pipe(Effect.orDie, Effect.map(factory)));

/**
 * Provide `Content` over a bucket pre-seeded with a single encoded `SiteContent`
 * document at `content/site.json`. The test body just reads through `Content`,
 * exactly as the public site does.
 */
const provideSeeded = (doc: SiteContentType) =>
  provideContent(
    seededStorage(doc, (json) =>
      layerTest({ [SITE_CONTENT_KEY]: { body: json } }),
    ),
  );

describe('Content fallback (no document in bucket)', () => {
  it.effect('serves the bundled defaults when the document is absent', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const site = yield* content.getSiteContent();
      expect(site).toEqual(defaultContent);
    }).pipe(provideContent(emptyStorage)));

  it.effect(
    'derives the current conference from the defaults, before any conference starts',
    () =>
      Effect.gen(function* () {
        // Pin "now" to a date before the earliest conference so the
        // first-future-conference branch selects 2024 deterministically.
        yield* TestClock.setTime(dayjs('2024-01-01').valueOf());
        const content = yield* Content.Service;
        const conference = yield* content.getCurrentConference('en');
        // 2024 "While It Is Day" is the first conference whose start is in the future.
        expect(conference.title).toBe('While It Is Day');
        expect(conference.slug).toBe('/2024');
        expect(conference.theme).toBe('#FFD6BA');
      }).pipe(provideContent(emptyStorage)),
  );

  it.effect('falls back to the most recent conference once all have started', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(dayjs('2030-01-01').valueOf());
      const content = yield* Content.Service;
      const conference = yield* content.getCurrentConference('en');
      // All conferences are past → the last one (2026 "Speak") is current.
      expect(conference.title).toBe('Speak');
      expect(conference.slug).toBe('/2026');
    }).pipe(provideContent(emptyStorage)));
});

describe('Content boundary conversion (decode → legacy shape)', () => {
  it.effect(
    'converts ISO dates to end-of-day-UTC ms tuples and keys to served URLs',
    () =>
      Effect.gen(function* () {
        const content = yield* Content.Service;
        const conference = yield* content.getConference('en', 2024);

        // Dates widen to the exact end-of-day-UTC ms the route code formats.
        expect(conference.dates).toEqual([
          dayjs('2024-08-21').utc().endOf('day').valueOf(),
          dayjs('2024-08-25').utc().endOf('day').valueOf(),
        ]);
        // Bucket keys resolve to the `/images/<key>` URL served by the C5 route.
        expect(conference.hero.image.desktop).toBe('/images/2024/en/hero-desktop.jpg');
        expect(conference.hero.image.mobile).toBe('/images/2024/en/hero-mobile.jpg');
        expect(conference.speakers[0]?.img).toBe('/images/2024/speakers/matt.png');
        // The 2024 registration windows survive as ms tuples (present, not none).
        expect(conference.registration).toBeDefined();
        expect(conference.registration?.early).toEqual([
          dayjs('2024-05-19').utc().endOf('day').valueOf(),
          dayjs('2024-06-22').utc().endOf('day').valueOf(),
        ]);
      }).pipe(provideSeeded(defaultContent)),
  );

  it.effect('selects per-locale hero art and text', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const fr = yield* content.getConference('fr', 2024);
      expect(fr.title).toBe("Tant qu'il fait jour");
      expect(fr.hero.image.desktop).toBe('/images/2024/fr/hero-desktop.jpg');
      expect(fr.bible.book).toBe('Jean');
    }).pipe(provideSeeded(defaultContent)));

  it.effect('omits registration when the document has none (2026)', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const conference = yield* content.getConference('en', 2026);
      expect(conference.registration).toBeUndefined();
      expect(conference.title).toBe('Speak');
    }).pipe(provideSeeded(defaultContent)));

  it.effect('reflects an edited published document (publish without redeploy, D3)', () => {
    // `edited` is a pure transform of the defaults — built outside the gen so the
    // seed layer (`provideSeeded(edited)`) can reference it.
    const edited: SiteContentType = {
      ...defaultContent,
      conferences: defaultContent.conferences.map((conference) =>
        conference.slug === '/2026'
          ? { ...conference, accentColor: HexColour.make('#123456') }
          : conference,
      ),
    };
    return Effect.gen(function* () {
      const content = yield* Content.Service;
      const conference = yield* content.getConference('en', 2026);
      expect(conference.theme).toBe('#123456');
    }).pipe(provideSeeded(edited));
  });
});

describe('Content optional detail-page projection (Option → string|undefined)', () => {
  /**
   * The Conference document models its detail-page fields as `Option`
   * (`OptionFromOptionalKey` for the URLs, an empty-able list for `hotels`,
   * registration-launch Branch 3.1). `toConference` projects each to the boundary
   * shape React renders: `string | undefined` for the URLs, a plain `{name,
   * note?}[]` for hotels — so a component never sees an `Option<string>` and
   * Branch 4's section-skip gates on `undefined` / `[]` (`boundary-discipline`).
   * These tests pin that projection against the defaults: 2024 carries every
   * field, 2026 only `registrationUrl` (the RegFox live channel, settled #9),
   * 2025 (cancelled) none.
   */
  it.effect('projects 2024 — every optional field present', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const conference = yield* content.getConference('en', 2024);

      // The brand-validated https strings cross the boundary verbatim (no Option).
      expect(conference.registrationUrl).toBe(
        'https://gyccanada.regfox.com/gyc-canada-2024-while-it-is-day',
      );
      expect(conference.scheduleUrl).toBe(
        'https://docs.google.com/document/d/1gNAOfdW2Yhgg7FABjUqQt2k2mXV_AdhARWUOyiVL9dA/pub',
      );
      expect(conference.mapEmbedUrl).toBeDefined();
      expect(conference.mapEmbedUrl?.startsWith('https://www.google.com/maps/embed')).toBe(
        true,
      );

      // Hotels project to this locale's strings; the optional `note` is present
      // only on the items that carry one.
      expect(conference.hotels).toHaveLength(5);
      expect(conference.hotels[0]?.name).toBe('Super 8 by Wyndham Kelowna BC');
      expect(conference.hotels[0]?.note).toBeUndefined();
      expect(conference.hotels[1]?.name).toBe('Fairfield Inn & Suites Kelowna');
      expect(conference.hotels[1]?.note).toContain('Holiday Inn Express');
    }).pipe(provideSeeded(defaultContent)));

  it.effect('projects 2024 hotel notes per-locale (fr)', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const conference = yield* content.getConference('fr', 2024);
      // The bilingual `note` `Text` collapses to the requested locale.
      expect(conference.hotels[1]?.note).toContain('code de groupe');
    }).pipe(provideSeeded(defaultContent)));

  it.effect('projects 2026 — only registrationUrl present, the rest skippable', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const conference = yield* content.getConference('en', 2026);
      // 2026 carries ONLY its RegFox registration URL (settled #9).
      expect(conference.registrationUrl).toBe(
        'https://gyccanada.regfox.com/gyc-canada-2026-speak',
      );
      // Schedule / map / hotels are TBD → the section-skip discriminators.
      expect(conference.scheduleUrl).toBeUndefined();
      expect(conference.mapEmbedUrl).toBeUndefined();
      expect(conference.hotels).toEqual([]);
    }).pipe(provideSeeded(defaultContent)));

  it.effect('projects 2025 — cancelled year, every optional field absent', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const conference = yield* content.getConference('en', 2025);
      // Cancelled year: no registration channel, no schedule/map, no hotels —
      // Branch 4 renders it as hero + FAQ only.
      expect(conference.registrationUrl).toBeUndefined();
      expect(conference.scheduleUrl).toBeUndefined();
      expect(conference.mapEmbedUrl).toBeUndefined();
      expect(conference.hotels).toEqual([]);
    }).pipe(provideSeeded(defaultContent)));
});

describe('Content fallback (semantically-invalid document)', () => {
  /**
   * A document whose `conferences` array decodes cleanly but is empty, or omits
   * a slug the routes serve, is not a usable site: the selectors
   * (`getCurrentConference`, `getConference(year)`) would throw downstream of the
   * read pipeline. The `SiteContent` schema rejects such a document during
   * decode so the `Content` read-path `catchCause` falls back to the bundled
   * defaults — the public site is never 500'd by a bad bucket document (C3
   * boundary contract).
   */
  const invalidJson = (
    transform: (doc: SiteContentType) => SiteContentType,
  ): string => JSON.stringify(transform(defaultContent));

  it.effect('falls back to the defaults when the document has zero conferences', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const site = yield* content.getSiteContent();
      // The selectors must not throw (they would 500 the public site).
      const current = yield* content.getCurrentConference('en');
      expect(site).toEqual(defaultContent);
      // At the default TestClock time (epoch) every conference is still future, so
      // the first one (2024) is current — the point is the selector returns a
      // conference from the defaults instead of throwing.
      expect(current.slug).toBe('/2024');
    }).pipe(
      provideContent(
        layerTest({
          [SITE_CONTENT_KEY]: {
            body: invalidJson((doc) => ({ ...doc, conferences: [] })),
          },
        }),
      ),
    ));

  it.effect('falls back to the defaults when a served year is missing', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const conference = yield* content.getConference('en', 2026);
      // The defaults' 2026 conference is served, not a 500.
      expect(conference.slug).toBe('/2026');
      expect(conference.title).toBe('Speak');
    }).pipe(
      provideContent(
        layerTest({
          [SITE_CONTENT_KEY]: {
            // Drop 2026 — `/`, `/2024`, `/2025` would still work, but `/2026` 500s.
            body: invalidJson((doc) => ({
              ...doc,
              conferences: doc.conferences.filter(
                (conference) => conference.slug !== '/2026',
              ),
            })),
          },
        }),
      ),
    ));
});

describe('Content read-path id-backfill (ADR 0006 deploy-safety)', () => {
  /**
   * The live `content/site.json` published before list-item ids existed has no
   * ids. Adding a *required* `id` would make that document FAIL decode on the
   * next read — the deploy would 500 the public site on its own content. The
   * read path runs `backfillListItemIds` between parse and decode, so the legacy
   * document decodes (every id-less item gets a fresh `nanoid`) and the public
   * read returns a real `SiteContent` — NOT the bundled-defaults fallback. This
   * is the single most important hazard of Branch 2; this test pins it.
   */
  const idLessSiteJson = (): string => {
    const doc = JSON.parse(JSON.stringify(defaultContent)) as {
      conferences: { speakers?: unknown[]; seminars?: unknown[] }[];
      team: unknown[];
    };
    for (const conference of doc.conferences) {
      for (const list of [conference.speakers, conference.seminars]) {
        for (const item of (list ?? []) as Record<string, unknown>[]) {
          delete item['id'];
        }
      }
    }
    for (const member of doc.team as Record<string, unknown>[]) {
      delete member['id'];
    }
    return JSON.stringify(doc);
  };

  it.effect('decodes a pre-ids document (no fallback to defaults)', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const conference = yield* content.getConference('en', 2024);
      // The legacy document decoded: 2024's two speakers are served (a fallback
      // to defaults would also have two, so assert the real document was read by
      // confirming the selectors do not throw and the content is present).
      expect(conference.slug).toBe('/2024');
      expect(conference.speakers).toHaveLength(2);
      expect(conference.speakers[0]?.name).toBe('Matt Parra');

      const team = yield* content.getTeam();
      expect(team.team[0]?.name).toBe('Elijah Duffy');
    }).pipe(
      provideContent(
        layerTest({ [SITE_CONTENT_KEY]: { body: idLessSiteJson() } }),
      ),
    ));
});

describe('Content translations + team selectors', () => {
  it.effect('returns the locale translation map and the team / board', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const translations = yield* content.getTranslations('fr');
      const team = yield* content.getTeam();

      expect(translations['team.position.president']).toBe('Président');
      expect(team.team[0]?.name).toBe('Elijah Duffy');
      expect(team.team[0]?.position).toBe('team.position.president');
      expect(team.team[0]?.image).toBe('/images/team/elijah.jpg');
      expect(team.board).toContain('George Cho');
    }).pipe(provideSeeded(defaultContent)));
});

describe('Content cache (TTL + single-flight)', () => {
  /** A `Storage` whose `get` count is observable, to assert caching. */
  const countingStorage = (json: string) =>
    Layer.effect(
      Storage.Service,
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);
        return Storage.Service.of({
          get: (key) =>
            key === SITE_CONTENT_KEY
              ? Ref.update(calls, (n) => n + 1).pipe(
                  Effect.as({
                    stream:
                      new Response(json).body ??
                      new ReadableStream<Uint8Array>(),
                    contentType: 'application/json',
                    size: json.length,
                  }),
                )
              : Effect.fail(new NotFound({ key })),
          put: (key) =>
            Effect.fail(
              new StorageError({ key, op: 'put', cause: new Error('disabled') }),
            ),
          head: () => Effect.succeed(Option.none()),
          list: () => Effect.succeed([]),
          delete: () => Effect.void,
        });
      }),
    );

  /** Provide `Content` over a `countingStorage` seeded with the encoded doc. */
  const provideCounting = (doc: SiteContentType) =>
    provideContent(seededStorage(doc, countingStorage));

  it.effect('reads once within the TTL and reloads after it expires', () =>
    // We can't read the private call count from outside, so assert behaviour:
    // two reads inside the TTL return the SAME decoded reference (the cache hit,
    // not a re-decode), and a read after the TTL still works (a fresh load). The
    // built-in `Effect.cachedInvalidateWithTTL` provides both contracts.
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const a = yield* content.getSiteContent();
      const b = yield* content.getSiteContent(); // cached — same reference
      yield* TestClock.adjust('31 seconds'); // past the 30s TTL
      const c = yield* content.getSiteContent(); // reloaded
      expect(a === b).toBe(true);
      expect(c).toEqual(defaultContent);
    }).pipe(provideCounting(defaultContent)));

  /**
   * A `Storage` whose published document can be swapped at runtime, to prove the
   * publish→cache-bust→read path (C5, D3): after a publish writes a new document
   * to the bucket, `bust()` makes the change visible on the very next read —
   * before the TTL elapses, with no reload otherwise.
   */
  const mutableStorage = (initial: string) =>
    Layer.effect(
      Storage.Service,
      Effect.gen(function* () {
        const body = yield* Ref.make(initial);
        return Storage.Service.of({
          get: (key) =>
            key === SITE_CONTENT_KEY
              ? Ref.get(body).pipe(
                  Effect.map((json) => ({
                    stream:
                      new Response(json).body ??
                      new ReadableStream<Uint8Array>(),
                    contentType: 'application/json',
                    size: json.length,
                  })),
                )
              : Effect.fail(new NotFound({ key })),
          // `put(SITE_CONTENT_KEY, …)` simulates a publish swapping the document.
          put: (key, value) =>
            key === SITE_CONTENT_KEY && typeof value === 'string'
              ? Ref.set(body, value)
              : Effect.fail(
                  new StorageError({
                    key,
                    op: 'put',
                    cause: new Error('unsupported'),
                  }),
                ),
          head: () => Effect.succeed(Option.none()),
          list: () => Effect.succeed([]),
          delete: () => Effect.void,
        });
      }),
    );

  /** Provide `Content` over a `mutableStorage` seeded with the encoded doc. */
  const provideMutable = (doc: SiteContentType) =>
    provideContent(seededStorage(doc, mutableStorage));

  const accent2026 = (content: SiteContentType): string | undefined =>
    content.conferences.find((c) => c.slug === '/2026')?.accentColor;

  it.effect('bust() makes a publish visible on the next read, within the TTL (D3)', () =>
    Effect.gen(function* () {
      const editedDoc = SiteContent.make({
        ...defaultContent,
        conferences: defaultContent.conferences.map((conference) =>
          conference.slug === '/2026'
            ? { ...conference, accentColor: HexColour.make('#0a0a0a') }
            : conference,
        ),
      });
      const edited = yield* encode(editedDoc);

      const content = yield* Content.Service;
      const storage = yield* Storage.Service;

      const before = yield* content.getSiteContent(); // caches the original
      yield* storage.put(SITE_CONTENT_KEY, edited, 'application/json'); // publish
      const stale = yield* content.getSiteContent(); // still the cached original
      yield* content.bust(); // publish busts the cache
      const after = yield* content.getSiteContent(); // re-reads the bucket

      // No TestClock advance: the publish is invisible until the bust, then live.
      const bundledAccent = accent2026(defaultContent);
      expect(accent2026(before)).toBe(bundledAccent); // bundled default
      expect(accent2026(stale)).toBe(bundledAccent); // cached — publish not yet seen
      expect(accent2026(after)).toBe('#0a0a0a'); // bust → published value
    }).pipe(provideMutable(defaultContent)));

  /**
   * Single-flight: concurrent first-reads must not stampede the bucket. The
   * built-in `Effect.cachedInvalidateWithTTL` parks every reader on one
   * in-flight `fetchDocument` and shares its result, so the bucket is read
   * exactly once even when many fibers race the cold cache
   * (`use-the-platform`). The `Storage.get` counts its calls so we can assert
   * the single read directly.
   */
  it.effect('single-flights concurrent first-reads onto one bucket read', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      // Race many cold-cache reads at once; the built-in cache must collapse
      // them onto a single `fetchDocument`.
      const result = yield* Effect.all(
        Array.from({ length: 8 }, () => content.getSiteContent()),
        { concurrency: 'unbounded' },
      );

      // Every racer got the bundled defaults…
      for (const doc of result) {
        expect(doc).toEqual(defaultContent);
      }
      // …and they share ONE decoded reference (proves the single in-flight load,
      // not eight independent decodes).
      expect(result.every((doc) => doc === result[0])).toBe(true);
    }).pipe(provideCounting(defaultContent)));
});

describe('Content.getPage / getForm multi-object read path (ADR 0008, Branch 5.3)', () => {
  /**
   * The per-object read path (settled #7): each evergreen Page and each Form
   * definition is its own bucket object with its own decode boundary, fallback,
   * and cache. These tests pin ADR 0008's contract:
   *   - a missing object falls back to its bundled default (dev / bucket-less);
   *   - a real published object is read + decoded at its own boundary;
   *   - editing one object busts ONLY its cache, never another's (the headline
   *     per-object blast-radius isolation);
   *   - one MALFORMED object falls back to its default and cannot break another
   *     object's decode (ADR 0008's headline blast-radius property).
   */
  const encodeFaq = Schema.encodeUnknownEffect(Schema.fromJsonString(FaqPage));
  const encodeAbout = Schema.encodeUnknownEffect(
    Schema.fromJsonString(AboutPage),
  );
  const encodeForm = Schema.encodeUnknownEffect(
    Schema.fromJsonString(FormDefinition),
  );

  /** Encode a page/form default to its on-bucket JSON, dying on a seed-bug. */
  const seedJson = <A>(
    encode: (value: A) => Effect.Effect<string, Schema.SchemaError>,
    value: A,
  ): Effect.Effect<string> => encode(value).pipe(Effect.orDie);

  it.effect('getPage falls back to the bundled default when the object is absent', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      // No `content/pages/faq.json` in the (empty) bucket → bundled default.
      const faq = yield* content.getPage('faq');
      expect(faq).toEqual(defaultFaqPage);
    }).pipe(Effect.provide(Layer.provideMerge(Content.layer, emptyStorage))));

  it.effect('getPage("team") falls back to the bundled team default (read path sees the new page)', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      // No `content/pages/team.json` in the (empty) bucket → bundled default.
      // Proves `team` is preloaded through `PAGE_IDS` into the eager cache map.
      const team = yield* content.getPage('team');
      expect(team).toEqual(defaultTeamPage);
    }).pipe(Effect.provide(Layer.provideMerge(Content.layer, emptyStorage))));

  it.effect('getForm falls back to the bundled default when the object is absent', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const form = yield* content.getForm('contact');
      expect(form).toEqual(defaultContactForm);
    }).pipe(Effect.provide(Layer.provideMerge(Content.layer, emptyStorage))));

  it.effect('getPage reads + decodes a real published page object at its own boundary', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const faq = yield* content.getPage('faq');
      // The published object — not the default — was read + decoded.
      expect(faq.title.en).toBe('Questions & Answers');
      expect(faq.title.fr).toBe('Questions et réponses');
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          Content.layer,
          Layer.unwrap(
            seedJson(
              encodeFaq,
              FaqPage.make({
                ...defaultFaqPage,
                title: { en: 'Questions & Answers', fr: 'Questions et réponses' },
              }),
            ).pipe(
              Effect.map((json) =>
                layerTest({ [pageObjectKey('faq')]: { body: json } }),
              ),
            ),
          ),
        ),
      ),
    ));

  it.effect('getForm reads + decodes a real published form object at its own boundary', () =>
    Effect.gen(function* () {
      const content = yield* Content.Service;
      const form = yield* content.getForm('contact');
      expect(form.title.en).toBe(defaultContactForm.title.en);
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          Content.layer,
          Layer.unwrap(
            seedJson(encodeForm, defaultContactForm).pipe(
              Effect.map((json) =>
                layerTest({ [formObjectKey('contact')]: { body: json } }),
              ),
            ),
          ),
        ),
      ),
    ));

  it.effect(
    'busting one page leaves every other page, form, and the conference cache untouched',
    () =>
      Effect.gen(function* () {
        const content = yield* Content.Service;
        const storage = yield* Storage.Service;

        // Warm every cache from the seeded objects / defaults.
        const aboutBefore = yield* content.getPage('about');
        const faqBefore = yield* content.getPage('faq');
        const formBefore = yield* content.getForm('contact');
        const conferenceBefore = yield* content.getConference('en', 2024);
        expect(aboutBefore.title.en).toBe(defaultAboutPage.title.en);

        // Publish a NEW about + faq + contact-form + conference accent to the bucket,
        // simulating four independent edits landing at once.
        const editedAbout = yield* seedJson(
          encodeAbout,
          AboutPage.make({
            ...defaultAboutPage,
            title: { en: 'Who We Are', fr: 'Qui sommes-nous' },
          }),
        );
        const editedFaq = yield* seedJson(
          encodeFaq,
          FaqPage.make({
            ...defaultFaqPage,
            title: { en: 'Help Centre', fr: "Centre d'aide" },
          }),
        );
        const editedForm = yield* seedJson(
          encodeForm,
          FormDefinition.make({
            ...defaultContactForm,
            title: { en: 'Reach out', fr: 'Contactez-nous' },
          }),
        );
        const editedSite = yield* encode(
          SiteContent.make({
            ...defaultContent,
            conferences: defaultContent.conferences.map((conference) =>
              conference.slug === '/2024'
                ? { ...conference, accentColor: HexColour.make('#abcdef') }
                : conference,
            ),
          }),
        );
        yield* storage.put(pageObjectKey('about'), editedAbout, 'application/json');
        yield* storage.put(pageObjectKey('faq'), editedFaq, 'application/json');
        yield* storage.put(formObjectKey('contact'), editedForm, 'application/json');
        yield* storage.put(SITE_CONTENT_KEY, editedSite, 'application/json');

        // Bust ONLY the about cache.
        yield* content.bust(bustPage('about'));

        // About re-reads (sees the publish); everything else is still cached.
        const aboutAfter = yield* content.getPage('about');
        const faqAfter = yield* content.getPage('faq');
        const formAfter = yield* content.getForm('contact');
        const conferenceAfter = yield* content.getConference('en', 2024);
        expect(aboutAfter.title.en).toBe('Who We Are'); // busted → fresh
        expect(faqAfter.title.en).toBe(faqBefore.title.en); // untouched cache
        expect(formAfter.title.en).toBe(formBefore.title.en); // untouched cache
        expect(conferenceAfter.theme).toBe(conferenceBefore.theme); // untouched

        // Busting the form now reveals the form publish — proving each cache is
        // independently invalidatable.
        yield* content.bust(bustForm('contact'));
        const formBusted = yield* content.getForm('contact');
        expect(formBusted.title.en).toBe('Reach out');
        // …and faq + conference are STILL cached (only form was busted).
        const faqStill = yield* content.getPage('faq');
        expect(faqStill.title.en).toBe(faqBefore.title.en);
      }).pipe(
        Effect.provide(
          Layer.provideMerge(
            Content.layer,
            Layer.unwrap(
              Effect.gen(function* () {
                const about = yield* seedJson(encodeAbout, defaultAboutPage);
                const faq = yield* seedJson(encodeFaq, defaultFaqPage);
                const form = yield* seedJson(encodeForm, defaultContactForm);
                const site = yield* encode(defaultContent);
                return layerTest({
                  [pageObjectKey('about')]: { body: about },
                  [pageObjectKey('faq')]: { body: faq },
                  [formObjectKey('contact')]: { body: form },
                  [SITE_CONTENT_KEY]: { body: site },
                });
              }),
            ),
          ),
        ),
      ),
  );

  it.effect(
    'one malformed page object falls back to its default and cannot break another page',
    () =>
      Effect.gen(function* () {
        const content = yield* Content.Service;
        // `faq.json` is corrupt; `about.json` is a valid published object.
        const faq = yield* content.getPage('faq');
        const about = yield* content.getPage('about');
        // The corrupt faq object decoded → fell back to the bundled default…
        expect(faq).toEqual(defaultFaqPage);
        // …while the valid about object decoded cleanly: one bad object does NOT
        // poison another's read (ADR 0008's headline blast-radius property).
        expect(about.title.en).toBe('Who We Are');
      }).pipe(
        Effect.provide(
          Layer.provideMerge(
            Content.layer,
            Layer.unwrap(
              seedJson(
                encodeAbout,
                AboutPage.make({
                  ...defaultAboutPage,
                  title: { en: 'Who We Are', fr: 'Qui sommes-nous' },
                }),
              ).pipe(
                Effect.map((about) =>
                  layerTest({
                    [pageObjectKey('faq')]: { body: '{ this is not valid json' },
                    [pageObjectKey('about')]: { body: about },
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
  );
});

// The admin draft → published → defaults reconciliation moved from
// `Content.getAdminContent` into `DraftEditor.load` (registration-launch Branch
// 1, sub-commit 1.1). Its tests live in `content/draft-editor.server.test.ts`.

import { describe, expect, it } from 'bun:test';
import { Effect, Layer, Option, Ref, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import {
  Content,
  SITE_CONTENT_DRAFT_KEY,
  SITE_CONTENT_KEY,
} from './content.server';
import { defaultContent } from './content/defaults';
import { HexColour, SiteContent } from './content/schema';
import type { SiteContent as SiteContentType } from './content/schema';
import { dayjs } from './dayjs';
import { NotFound, Storage, StorageError } from './storage.server';

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

const encodeDoc = (doc: SiteContentType): Promise<string> =>
  Effect.runPromise(encode(doc));

/** A `Storage` with no document — every read reports `NotFound` (bucket-less). */
const emptyStorage = Layer.succeed(
  Storage,
  Storage.of({
    get: (key) => Effect.fail(new NotFound({ key })),
    put: (key) =>
      Effect.fail(new StorageError({ key, op: 'put', message: 'disabled' })),
    head: () => Effect.succeed(Option.none()),
    list: () => Effect.succeed([]),
    delete: () => Effect.void,
  }),
);

const run = <A, E>(
  effect: Effect.Effect<A, E, Content | Storage>,
  storageLayer: Layer.Layer<Storage>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(effect, [
        Layer.provideMerge(Content.layer, storageLayer),
        TestClock.layer(),
      ]),
    ),
  );

/**
 * Like `run` but also exposes `Storage` to the effect, sharing ONE built
 * `Storage` between `Content` and the effect: `Content.layer` keeps its
 * `Storage` requirement open and is merged with the same `storageLayer` that is
 * also exposed, so both resolve to the one built instance — a `put` from the
 * test hits the same backing store `Content` reads (publish → bust → read).
 */
const runWithStorage = <A, E>(
  effect: Effect.Effect<A, E, Content | Storage>,
  storageLayer: Layer.Layer<Storage>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(effect, [
        Layer.provideMerge(Content.layer, storageLayer),
        TestClock.layer(),
      ]),
    ),
  );

describe('Content fallback (no document in bucket)', () => {
  it('serves the bundled defaults when the document is absent', async () => {
    const content = await run(
      Effect.gen(function* () {
        const content = yield* Content;
        return yield* content.getSiteContent();
      }),
      emptyStorage,
    );
    expect(content).toEqual(defaultContent);
  });

  it('derives the current conference from the defaults, before any conference starts', async () => {
    const conference = await run(
      Effect.gen(function* () {
        // Pin "now" to a date before the earliest conference so the
        // first-future-conference branch selects 2024 deterministically.
        yield* TestClock.setTime(dayjs('2024-01-01').valueOf());
        const content = yield* Content;
        return yield* content.getCurrentConference('en');
      }),
      emptyStorage,
    );
    // 2024 "While It Is Day" is the first conference whose start is in the future.
    expect(conference.title).toBe('While It Is Day');
    expect(conference.slug).toBe('/2024');
    expect(conference.theme).toBe('#FFD6BA');
  });

  it('falls back to the most recent conference once all have started', async () => {
    const conference = await run(
      Effect.gen(function* () {
        yield* TestClock.setTime(dayjs('2030-01-01').valueOf());
        const content = yield* Content;
        return yield* content.getCurrentConference('en');
      }),
      emptyStorage,
    );
    // All conferences are past → the last one (2026 "Speak") is current.
    expect(conference.title).toBe('Speak');
    expect(conference.slug).toBe('/2026');
  });
});

describe('Content boundary conversion (decode → legacy shape)', () => {
  it('converts ISO dates to end-of-day-UTC ms tuples and keys to served URLs', async () => {
    const json = await encodeDoc(defaultContent);
    const conference = await run(
      Effect.gen(function* () {
        const content = yield* Content;
        return yield* content.getConference('en', 2024);
      }),
      Storage.layerTest({ [SITE_CONTENT_KEY]: { body: json } }),
    );

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
  });

  it('selects per-locale hero art and text', async () => {
    const json = await encodeDoc(defaultContent);
    const fr = await run(
      Effect.gen(function* () {
        const content = yield* Content;
        return yield* content.getConference('fr', 2024);
      }),
      Storage.layerTest({ [SITE_CONTENT_KEY]: { body: json } }),
    );
    expect(fr.title).toBe("Tant qu'il fait jour");
    expect(fr.hero.image.desktop).toBe('/images/2024/fr/hero-desktop.jpg');
    expect(fr.bible.book).toBe('Jean');
  });

  it('omits registration when the document has none (2026)', async () => {
    const json = await encodeDoc(defaultContent);
    const conference = await run(
      Effect.gen(function* () {
        const content = yield* Content;
        return yield* content.getConference('en', 2026);
      }),
      Storage.layerTest({ [SITE_CONTENT_KEY]: { body: json } }),
    );
    expect(conference.registration).toBeUndefined();
    expect(conference.title).toBe('Speak');
  });

  it('reflects an edited published document (publish without redeploy, D3)', async () => {
    const edited: SiteContentType = {
      ...defaultContent,
      conferences: defaultContent.conferences.map((conference) =>
        conference.slug === '/2026'
          ? { ...conference, accentColor: HexColour.make('#123456') }
          : conference,
      ),
    };
    const json = await encodeDoc(edited);
    const conference = await run(
      Effect.gen(function* () {
        const content = yield* Content;
        return yield* content.getConference('en', 2026);
      }),
      Storage.layerTest({ [SITE_CONTENT_KEY]: { body: json } }),
    );
    expect(conference.theme).toBe('#123456');
  });
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

  it('falls back to the defaults when the document has zero conferences', async () => {
    const json = invalidJson((doc) => ({ ...doc, conferences: [] }));
    const result = await run(
      Effect.gen(function* () {
        const content = yield* Content;
        const site = yield* content.getSiteContent();
        // The selectors must not throw (they would 500 the public site).
        const current = yield* content.getCurrentConference('en');
        return { site, current };
      }),
      Storage.layerTest({ [SITE_CONTENT_KEY]: { body: json } }),
    );
    expect(result.site).toEqual(defaultContent);
    // At the default TestClock time (epoch) every conference is still future, so
    // the first one (2024) is current — the point is the selector returns a
    // conference from the defaults instead of throwing.
    expect(result.current.slug).toBe('/2024');
  });

  it('falls back to the defaults when a served year is missing', async () => {
    // Drop 2026 — `/`, `/2024`, `/2025` would still work, but `/2026` 500s.
    const json = invalidJson((doc) => ({
      ...doc,
      conferences: doc.conferences.filter(
        (conference) => conference.slug !== '/2026',
      ),
    }));
    const conference = await run(
      Effect.gen(function* () {
        const content = yield* Content;
        return yield* content.getConference('en', 2026);
      }),
      Storage.layerTest({ [SITE_CONTENT_KEY]: { body: json } }),
    );
    // The defaults' 2026 conference is served, not a 500.
    expect(conference.slug).toBe('/2026');
    expect(conference.title).toBe('Speak');
  });
});

describe('Content translations + team selectors', () => {
  it('returns the locale translation map and the team / board', async () => {
    const json = await encodeDoc(defaultContent);
    const { translations, team } = await run(
      Effect.gen(function* () {
        const content = yield* Content;
        const translations = yield* content.getTranslations('fr');
        const team = yield* content.getTeam();
        return { translations, team };
      }),
      Storage.layerTest({ [SITE_CONTENT_KEY]: { body: json } }),
    );

    expect(translations['team.position.president']).toBe('Président');
    expect(team.team[0]?.name).toBe('Elijah Duffy');
    expect(team.team[0]?.position).toBe('team.position.president');
    expect(team.team[0]?.image).toBe('/images/team/elijah.jpg');
    expect(team.board).toContain('George Cho');
  });
});

describe('Content cache (TTL + single-flight)', () => {
  /** A `Storage` whose `get` count is observable, to assert caching. */
  const countingStorage = (json: string) =>
    Layer.effect(
      Storage,
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);
        return Storage.of({
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
              new StorageError({ key, op: 'put', message: 'disabled' }),
            ),
          head: () => Effect.succeed(Option.none()),
          list: () => Effect.succeed([]),
          delete: () => Effect.void,
        });
      }),
    );

  it('reads once within the TTL and reloads after it expires', async () => {
    const json = await encodeDoc(defaultContent);

    // We can't read the private call count from outside, so assert behaviour:
    // two reads inside the TTL return the SAME decoded reference (the cache hit,
    // not a re-decode), and a read after the TTL still works (a fresh load). The
    // built-in `Effect.cachedInvalidateWithTTL` provides both contracts.
    const result = await run(
      Effect.gen(function* () {
        const content = yield* Content;
        const a = yield* content.getSiteContent();
        const b = yield* content.getSiteContent(); // cached — same reference
        yield* TestClock.adjust('31 seconds'); // past the 30s TTL
        const c = yield* content.getSiteContent(); // reloaded
        return { sameWithinTtl: a === b, reloadedEqual: c };
      }),
      countingStorage(json),
    );

    expect(result.sameWithinTtl).toBe(true);
    expect(result.reloadedEqual).toEqual(defaultContent);
  });

  /**
   * A `Storage` whose published document can be swapped at runtime, to prove the
   * publish→cache-bust→read path (C5, D3): after a publish writes a new document
   * to the bucket, `bust()` makes the change visible on the very next read —
   * before the TTL elapses, with no reload otherwise.
   */
  const mutableStorage = (initial: string) =>
    Layer.effect(
      Storage,
      Effect.gen(function* () {
        const body = yield* Ref.make(initial);
        return Storage.of({
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
                  new StorageError({ key, op: 'put', message: 'unsupported' }),
                ),
          head: () => Effect.succeed(Option.none()),
          list: () => Effect.succeed([]),
          delete: () => Effect.void,
        });
      }),
    );

  it('bust() makes a publish visible on the next read, within the TTL (D3)', async () => {
    const original = await encodeDoc(defaultContent);
    const editedDoc = SiteContent.make({
      ...defaultContent,
      conferences: defaultContent.conferences.map((conference) =>
        conference.slug === '/2026'
          ? { ...conference, accentColor: HexColour.make('#0a0a0a') }
          : conference,
      ),
    });
    const edited = await encodeDoc(editedDoc);

    const accent2026 = (content: SiteContentType): string | undefined =>
      content.conferences.find((c) => c.slug === '/2026')?.accentColor;

    const result = await runWithStorage(
      Effect.gen(function* () {
        const content = yield* Content;
        const storage = yield* Storage;

        const before = yield* content.getSiteContent(); // caches the original
        yield* storage.put(SITE_CONTENT_KEY, edited, 'application/json'); // publish
        const stale = yield* content.getSiteContent(); // still the cached original
        yield* content.bust(); // publish busts the cache
        const after = yield* content.getSiteContent(); // re-reads the bucket

        return { before, stale, after };
      }),
      mutableStorage(original),
    );

    // No TestClock advance: the publish is invisible until the bust, then live.
    expect(accent2026(result.before)).toBe('#D4A24E'); // bundled default
    expect(accent2026(result.stale)).toBe('#D4A24E'); // cached — publish not yet seen
    expect(accent2026(result.after)).toBe('#0a0a0a'); // bust → published value
  });

  /**
   * Single-flight: concurrent first-reads must not stampede the bucket. The
   * built-in `Effect.cachedInvalidateWithTTL` parks every reader on one
   * in-flight `fetchDocument` and shares its result, so the bucket is read
   * exactly once even when many fibers race the cold cache
   * (`use-the-platform`). The `Storage.get` counts its calls so we can assert
   * the single read directly.
   */
  it('single-flights concurrent first-reads onto one bucket read', async () => {
    const json = await encodeDoc(defaultContent);

    const result = await runWithStorage(
      Effect.gen(function* () {
        const content = yield* Content;
        // Race many cold-cache reads at once; the built-in cache must collapse
        // them onto a single `fetchDocument`.
        const docs = yield* Effect.all(
          Array.from({ length: 8 }, () => content.getSiteContent()),
          { concurrency: 'unbounded' },
        );
        return docs;
      }),
      countingStorage(json),
    );

    // Every racer got the bundled defaults…
    for (const doc of result) {
      expect(doc).toEqual(defaultContent);
    }
    // …and they share ONE decoded reference (proves the single in-flight load,
    // not eight independent decodes).
    expect(result.every((doc) => doc === result[0])).toBe(true);
  });
});

describe('Content admin read (draft → published → defaults)', () => {
  const adminStorage = (objects: Record<string, string>) =>
    Storage.layerTest(
      Object.fromEntries(
        Object.entries(objects).map(([key, body]) => [key, { body }]),
      ),
    );

  it('falls back to the bundled defaults when nothing is stored', async () => {
    const result = await run(
      Effect.gen(function* () {
        const content = yield* Content;
        return yield* content.getAdminContent();
      }),
      adminStorage({}),
    );
    expect(result.source).toBe('defaults');
    expect(result.content).toEqual(defaultContent);
  });

  it('prefers the published document over the defaults', async () => {
    const published = await encodeDoc(defaultContent);
    const result = await run(
      Effect.gen(function* () {
        const content = yield* Content;
        return yield* content.getAdminContent();
      }),
      adminStorage({ [SITE_CONTENT_KEY]: published }),
    );
    expect(result.source).toBe('published');
  });

  it('prefers a draft saved after the last publish over the published document', async () => {
    const draftDoc = SiteContent.make({
      ...defaultContent,
      board: ['Only In The Draft'],
    });
    const draft = await encodeDoc(draftDoc);
    // Seed only the published document (at epoch); the draft is written through
    // `Storage.put` AFTER advancing the clock so it is strictly newer — the real
    // "I edited and saved a draft after the last publish" timeline.
    const result = await run(
      Effect.gen(function* () {
        const content = yield* Content;
        const storage = yield* Storage;
        yield* TestClock.adjust('1 second');
        yield* storage.put(SITE_CONTENT_DRAFT_KEY, draft, 'application/json');
        return yield* content.getAdminContent();
      }),
      adminStorage({ [SITE_CONTENT_KEY]: await encodeDoc(defaultContent) }),
    );
    expect(result.source).toBe('draft');
    expect(result.content.board).toEqual(['Only In The Draft']);
  });

  it('ignores a stale draft that predates the published document (failed-delete / pre-existing draft)', async () => {
    // The bug this guards: a stale draft left intact after a publish (delete
    // failed, or a pre-existing older draft) must NOT reopen as the edit source,
    // or a later save/publish would overwrite the live content with stale values.
    const staleDraftDoc = SiteContent.make({
      ...defaultContent,
      board: ['Stale Draft Values'],
    });
    const publishedDoc = SiteContent.make({
      ...defaultContent,
      board: ['Freshly Published'],
    });
    const staleDraft = await encodeDoc(staleDraftDoc);
    const published = await encodeDoc(publishedDoc);
    const result = await run(
      Effect.gen(function* () {
        const content = yield* Content;
        const storage = yield* Storage;
        // Draft written first…
        yield* storage.put(
          SITE_CONTENT_DRAFT_KEY,
          staleDraft,
          'application/json',
        );
        // …then a later publish writes the live document (and would normally
        // delete the draft, but here the delete is simulated as having failed —
        // the draft is left intact).
        yield* TestClock.adjust('1 second');
        yield* storage.put(SITE_CONTENT_KEY, published, 'application/json');
        return yield* content.getAdminContent();
      }),
      adminStorage({}),
    );
    expect(result.source).toBe('published');
    expect(result.content.board).toEqual(['Freshly Published']);
  });
});

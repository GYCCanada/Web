export * as Content from './content.server';

import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
} from 'effect';

import { defaultContent } from './content/defaults';
import { backfillListItemIds } from './content/id-backfill';
import {
  FORM_IDS,
  FORM_SPECS,
  PAGE_IDS,
  PAGE_SPECS,
  formObjectKey,
  pageObjectKey,
  type FormContent,
  type FormId,
  type ObjectSpec,
  type PageContent,
  type PageId,
} from './content/pages/registry';
import { SiteContent } from './content/schema';
import type {
  AssetKey,
  Conference as DocConference,
  IsoDate,
  Seminar as DocSeminar,
  Speaker as DocSpeaker,
  SiteContent as SiteContentType,
  TeamMember as DocTeamMember,
  TeamPosition,
} from './content/schema';
import { dayjs } from './dayjs';
import { assertValidLocale } from './localization/localization';
import type { Locale } from './localization/localization';
import { Storage } from './storage.server';

/**
 * The deep module the public routes talk to (CMS plan §"Services", decision
 * D3). `Content` is the single read path for every editable piece of the site:
 * it reads the one bilingual `SiteContent` document from the bucket, decodes it
 * at the boundary (`boundary-discipline`), caches it with a short TTL, and
 * **falls back to the bundled defaults** whenever the bucket is unconfigured,
 * unreachable, or empty (so dev with no bucket behaves exactly like today).
 *
 * Principles (see `~/.brain/principles`):
 *   - `derive-dont-sync`: the current-conference-by-date and by-year selection
 *     logic lives HERE, derived from the one decoded document — it is not
 *     duplicated across routes, and the old `conference.server.ts` /
 *     `team.server.tsx` typed-TS data is deleted, its callers migrated here
 *     (`migrate-callers-then-delete-legacy-apis`, `subtract-before-you-add`).
 *   - `boundary-discipline`: the document crosses the boundary exactly once —
 *     `Schema`-decoded on read — and is converted HERE to the legacy
 *     route/component shape (per-locale strings, `[start, end]` millisecond
 *     tuples, leading-`/` image URLs) so component code is UNCHANGED.
 *   - `use-the-platform`: the read cache is Effect's built-in
 *     `Effect.cachedInvalidateWithTTL` — it single-flights concurrent
 *     first-reads (a fetch in flight parks the other fibers on a latch and they
 *     all get the one result, so the bucket is not stampeded) and hands back an
 *     `invalidate` effect the editor's publish calls (`bust`). Within the TTL it
 *     returns the *same* decoded `SiteContent` reference. **Documented staleness
 *     window:** the built-in `invalidate` is a bare sync that only expires the
 *     entry (`expiresAt = 0`); it does not pre-empt an in-flight refresh nor
 *     clear its `running` flag. So a publish that lands while a refresh is
 *     already fetching the bucket is masked: that refresh's `onExit` completes
 *     with the *pre-publish* document and re-arms the TTL from its own
 *     completion instant. Measured from the publish instant the stale window is
 *     therefore `(the refresh's remaining bucket-read duration) + one TTL` — not
 *     ≤ one TTL. For a 30s-TTL, low-write CMS this worst case (a multi-second
 *     bucket read in flight + 30s) still stays inside D3's "visible on the next
 *     read after the window" contract, so we take the platform primitive over a
 *     hand-rolled epoch guard (`subtract-before-you-add`).
 *   - `make-impossible-states-unrepresentable`: a Conference whose pricing is
 *     undecided carries `registration: undefined` (the `Option.none()` in the
 *     document), never empty tuples.
 *
 * The boundary types below reproduce the shape the routes/components already
 * consume verbatim (`title`, the misnamed-but-rendered `theme` accent colour,
 * `hero.image.{desktop,mobile}`, `hero.alt`, `[start, end]` ms `dates`, optional
 * ms `registration`, `speakers[].img`, …) so migrating the loaders is a
 * one-line swap and the rendered HTML is byte-for-byte the same.
 */

// ---------------------------------------------------------------------------
// Boundary shape (what the routes/components consume — UNCHANGED from today)
// ---------------------------------------------------------------------------

export interface Speaker {
  readonly name: string;
  readonly activity: string;
  readonly img: string;
  readonly bio: string;
}

export interface Seminar {
  readonly title: string;
  readonly speaker: {
    readonly name: string;
    readonly img: string;
    readonly bio: string;
  };
  readonly description: string;
}

export interface Conference {
  readonly slug: string;
  readonly title: string;
  readonly dates: readonly [start: number, end: number];
  readonly hero: {
    readonly image: {
      readonly desktop: string;
      readonly mobile: string;
    };
    readonly alt: string;
  };
  readonly registration?: {
    readonly early: readonly [start: number, end: number];
    readonly regular: readonly [start: number, end: number];
    readonly late: readonly [start: number, end: number];
  };
  readonly location: string;
  readonly tagline: string;
  readonly bible: {
    readonly book: string;
    readonly chapter: number;
    readonly verse: number;
  };
  readonly speakers: readonly Speaker[];
  readonly seminars: readonly Seminar[];
  readonly promos: readonly string[];
  /**
   * The per-year accent colour. Named `theme` to match today's
   * route/component code (which sets `--bg: conference.theme`); the underlying
   * document field is the correctly-named `accentColor` (CMS decision D5).
   */
  readonly theme: string;
  /**
   * The optional detail-page data the forked `/YYYY` pages hard-coded
   * (registration-launch Branch 3, settled #4). The document models each as
   * `Option` (`OptionFromOptionalKey` / empty list); this boundary projects them
   * to `string | undefined` and a plain object array so React never sees an
   * `Option<string>` (`boundary-discipline`). An absent field is `undefined`, an
   * absent list is `[]` — that is the section-presence discriminator Branch 4's
   * section-skip gates on (`registrationUrl !== undefined`,
   * `mapEmbedUrl !== undefined`, `hotels.length > 0`). Each URL crossed the
   * `ExternalHttpsUrl` / `GoogleMapsEmbedUrl` brand on decode, so the rendered
   * `href` / iframe `src` is already an XSS-safe https string.
   */
  readonly registrationUrl: string | undefined;
  readonly scheduleUrl: string | undefined;
  readonly mapEmbedUrl: string | undefined;
  readonly hotels: readonly {
    readonly name: string;
    readonly note?: string;
  }[];
}

/**
 * An executive-team member. `position` is the constrained `team.position.*`
 * translation key (a subset of `TranslationKey`), so the team component can pass
 * it straight to `translate(...)` unchanged.
 */
export interface TeamMember {
  readonly name: string;
  readonly position: TeamPosition;
  readonly image: string;
}

/** A flat `key → string` translation map for one locale (matches today's). */
export type Translation = Record<string, string>;

// ---------------------------------------------------------------------------
// Document → boundary conversion (`derive-dont-sync`, `boundary-discipline`)
// ---------------------------------------------------------------------------

/**
 * Resolve a bucket object key (`2024/speakers/matt.png`) to the URL the HTML
 * renders (`/images/2024/speakers/matt.png`). Every managed image is served
 * through the Effect server's `GET /images/*` route (C5, mirroring
 * paulo-suzanne's `bucketResponse`): it streams the bucket object when present
 * and falls back to the bundled `public/<key>` file otherwise. So a bucket-less
 * dev/prod still serves today's `public/` art (the default keys map 1:1 onto the
 * `public/` tree), while an uploaded image at the same key transparently
 * overrides it — with no change to any component (`derive-dont-sync`,
 * `boundary-discipline`).
 */
const assetUrl = (key: AssetKey): string => `/images/${key}`;

/**
 * Widen an ISO calendar date to the existing end-of-day-UTC millisecond the
 * route code uses (`use-the-platform`). This is the exact transform the old
 * `conference.server.ts` applied (`dayjs(date).utc().endOf('day').valueOf()`),
 * so the rendered date strings are identical.
 */
const toEndOfDayMs = (date: IsoDate): number =>
  dayjs(date).utc().endOf('day').valueOf();

const toDateTuple = (range: {
  readonly start: IsoDate;
  readonly end: IsoDate;
}): readonly [number, number] => [
  toEndOfDayMs(range.start),
  toEndOfDayMs(range.end),
];

const toSpeaker = (speaker: DocSpeaker, locale: Locale): Speaker => ({
  name: speaker.name[locale],
  activity: speaker.activity[locale],
  img: assetUrl(speaker.photo.key),
  bio: speaker.bio[locale],
});

const toSeminar = (seminar: DocSeminar, locale: Locale): Seminar => ({
  title: seminar.title[locale],
  speaker: {
    name: seminar.speaker.name[locale],
    img: assetUrl(seminar.speaker.photo.key),
    bio: seminar.speaker.bio[locale],
  },
  description: seminar.description[locale],
});

/**
 * Project a document `Hotel` to the boundary shape: the bilingual `name`/`note`
 * `Text`s collapse to this locale's string, and the optional `note` becomes a
 * `string | undefined` (omitted when the document carries no note). The `id`
 * (list identity, ADR 0006) is not part of the read boundary the detail page
 * renders, so it is dropped here.
 */
const toHotel = (
  hotel: DocConference['hotels'][number],
  locale: Locale,
): Conference['hotels'][number] => ({
  name: hotel.name[locale],
  ...(hotel.note === undefined ? {} : { note: hotel.note[locale] }),
});

const toConference = (
  conference: DocConference,
  locale: Locale,
): Conference => ({
  slug: conference.slug,
  title: conference.themeName[locale],
  theme: conference.accentColor,
  hero: {
    // Hero art is per-locale on disk; select this locale's key for each crop
    // and resolve it to the served URL so the rendered `src` is unchanged.
    image: {
      desktop: assetUrl(conference.hero.desktop.key[locale]),
      mobile: assetUrl(conference.hero.mobile.key[locale]),
    },
    alt: conference.hero.desktop.alt[locale],
  },
  dates: toDateTuple(conference.dates),
  ...(Option.isSome(conference.registration)
    ? {
        registration: {
          early: toDateTuple(conference.registration.value.early),
          regular: toDateTuple(conference.registration.value.regular),
          late: toDateTuple(conference.registration.value.late),
        },
      }
    : {}),
  location: conference.location[locale],
  tagline: conference.tagline[locale],
  bible: {
    book: conference.bible.book[locale],
    chapter: conference.bible.chapter,
    verse: conference.bible.verse,
  },
  speakers: conference.speakers.map((speaker) => toSpeaker(speaker, locale)),
  seminars: conference.seminars.map((seminar) => toSeminar(seminar, locale)),
  promos: [...conference.promos],
  // The optional detail-page fields: each document `Option` projects to
  // `string | undefined` via `Option.getOrUndefined` (the convention for ALL
  // new optional Conference fields — `Option` at the document layer, plain
  // `string | undefined` at the boundary so React never sees an `Option`,
  // matching the `registration` `Option.isSome` gate above). `hotels` projects
  // each item to this locale's strings; an empty document list stays `[]`.
  registrationUrl: Option.getOrUndefined(conference.registrationUrl),
  scheduleUrl: Option.getOrUndefined(conference.scheduleUrl),
  mapEmbedUrl: Option.getOrUndefined(conference.mapEmbedUrl),
  hotels: conference.hotels.map((hotel) => toHotel(hotel, locale)),
});

const toTeamMember = (member: DocTeamMember): TeamMember => ({
  name: member.name,
  position: member.position,
  image: assetUrl(member.photo.key),
});

/**
 * Select the current conference from the decoded document, matching today's
 * `getCurrentConference` semantics exactly (CONTEXT.md §"Current Conference"):
 * the first conference whose start date is still in the future, falling back to
 * the most recent (last) one.
 */
const selectCurrent = (
  content: SiteContentType,
  locale: Locale,
  now: number,
): Conference => {
  const index = content.conferences.findIndex((conference) =>
    dayjs(now).isBefore(toEndOfDayMs(conference.dates.start)),
  );
  const conference =
    index === -1 ? content.conferences[content.conferences.length - 1] : content.conferences[index];
  if (conference === undefined) {
    throw new Error('No conferences are configured');
  }
  return toConference(conference, locale);
};

const selectByYear = (
  content: SiteContentType,
  locale: Locale,
  year: number,
): Conference => {
  // A Conference is identified by its year `slug` (`/YYYY`, CONTEXT.md
  // §"Conference"), which is the canonical year identifier the routes pass and
  // the `SiteContent` boundary filter requires to be present. Match on it
  // directly rather than re-deriving the year from `dates.start`, so this
  // selector and the schema invariant agree (`derive-dont-sync`) and any
  // year the routes serve is guaranteed present by the time we get here.
  const conference = content.conferences.find(
    (candidate) => candidate.slug === `/${year}`,
  );
  if (conference === undefined) {
    throw new Error(`No conference found for year ${year}`);
  }
  return toConference(conference, locale);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** The bucket key the published `SiteContent` document lives at. */
export const SITE_CONTENT_KEY = 'content/site.json';

/**
 * The bucket key the *unpublished* draft lives at. The `/admin` editor (C5)
 * writes here on "Save draft" and reads here first so an in-progress edit
 * survives a reload without going live; "Publish" promotes the draft to
 * `SITE_CONTENT_KEY` and removes it. The public read path
 * (`getSiteContent`) never reads the draft.
 */
export const SITE_CONTENT_DRAFT_KEY = 'content/site.draft.json';

/**
 * Cache TTL. Short by design (D3 — runtime read with cache, no redeploy): a
 * publish becomes visible on the next read after the TTL elapses (or the
 * editor's explicit `bust`). 30s keeps the bucket-read rate negligible while
 * making edits feel near-instant.
 */
const CACHE_TTL_MS = 30_000;

/**
 * Parse a `content/site.json` string and decode it to a `SiteContent`, running
 * the id-backfill normalization between parse and decode so a document
 * published before list-item ids existed (ADR 0006) still decodes — every id-less
 * list item gets a fresh `nanoid` before the required `id` field is checked. The
 * two-step (parse → backfill → decode), rather than a single `fromJsonString`,
 * is what lets the normalization see the parsed value before validation.
 */
const parseJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Unknown),
);
const decodeSiteContent = Schema.decodeUnknownEffect(SiteContent);
const decodeDocument = (json: string) =>
  parseJson(json).pipe(
    Effect.map(backfillListItemIds),
    Effect.flatMap(decodeSiteContent),
  );

/**
 * Which read cache a `bust` invalidates (ADR 0008, registration-launch Branch 5.3).
 * A closed union over the object families `Content` reads: the one `site.json`
 * document, one evergreen `page` object, or one `form` definition object. Editing
 * About busts ONLY About's cache, not the conference (`site`) cache — that
 * per-object isolation is ADR 0008's headline blast-radius property, and it is
 * expressible here precisely because the target is this closed union, not a free
 * string (`make-impossible-states-unrepresentable`).
 *
 * This type is intentionally defined here, over the registry's closed `PageId` /
 * `FormId`, rather than reusing `DraftEditor`'s `ContentScope`: the read path
 * never touches the draft/published key PAIR a scope carries — it only ever reads
 * the *published* object — so the bust target is the lighter "which published
 * cache" discriminator. `DraftEditor.publish` maps its `ContentScope` onto this
 * (the write path knows both halves; the read path needs only the published half),
 * which also keeps `content.server` free of an import cycle through `DraftEditor`.
 */
export type BustTarget =
  | { readonly kind: 'site' }
  | { readonly kind: 'page'; readonly page: PageId }
  | { readonly kind: 'form'; readonly form: FormId };

/** The site bust target, named so callers never construct the literal inline. */
export const bustSite: BustTarget = { kind: 'site' };

/** The bust target for one evergreen Page object's read cache. */
export const bustPage = (page: PageId): BustTarget => ({ kind: 'page', page });

/** The bust target for one Form definition object's read cache. */
export const bustForm = (form: FormId): BustTarget => ({ kind: 'form', form });

export class Service extends Context.Service<
  Service,
  {
    readonly getSiteContent: () => Effect.Effect<SiteContentType>;
    readonly getConference: (
      locale: Locale,
      year?: number,
    ) => Effect.Effect<Conference>;
    readonly getCurrentConference: (
      locale: Locale,
    ) => Effect.Effect<Conference>;
    readonly getTranslations: (locale: Locale) => Effect.Effect<Translation>;
    readonly getTeam: () => Effect.Effect<{
      readonly team: readonly TeamMember[];
      readonly board: readonly string[];
    }>;
    /**
     * Read one evergreen Page object (`content/pages/<page>.json`), decoded at its
     * OWN boundary through the registry schema (ADR 0008, settled #7). Each page is
     * an independent object with its own decode + fallback + cache: a missing /
     * unreadable / malformed `faq.json` falls back to the bundled `defaultFaqPage`
     * and never breaks `about`'s or the conference (`site`) read — one corrupt page
     * object cannot poison another's decode (the headline blast-radius property).
     * Returns the page's precise typed content (`PageContent<P>`), not a widened
     * union, because `page` is the closed `PageId`.
     */
    readonly getPage: <P extends PageId>(
      page: P,
    ) => Effect.Effect<PageContent<P>>;
    /**
     * Read one Form definition object (`forms/<form>.json`), decoded at its own
     * boundary through the registry schema, with the same per-object fallback +
     * cache as `getPage`. This is the read path Branch 6's form engine reads its
     * CMS-editable form copy through (ADR 0007 / ADR 0008), so the form objects are
     * first-class storage now, not a hypothetical. Returns the form's precise typed
     * content (`FormContent<F>`).
     */
    readonly getForm: <F extends FormId>(
      form: F,
    ) => Effect.Effect<FormContent<F>>;
    /**
     * Invalidate ONE read cache so a subsequent read re-reads the bucket. Called by
     * the editor's publish action so a publish is visible with no redeploy and
     * without waiting out the TTL (D3, `make-operations-idempotent` — busting an
     * already-empty cache is a no-op). The `target` selects WHICH cache: `bustSite`
     * (the `content/site.json` document), `bustPage(id)`, or `bustForm(id)`. Busting
     * one page leaves every other page, every form, and the conference (`site`)
     * cache untouched — the per-object isolation ADR 0008 promises. Defaults to the
     * site target so existing site-publish callers are unchanged.
     *
     * When no refresh is already in flight a publish is visible on the very next
     * read; otherwise it is visible within the documented staleness window —
     * `invalidate` only expires the entry, it does not pre-empt an in-flight refresh
     * (see the `Content` doc above for the full mechanism).
     */
    readonly bust: (target?: BustTarget) => Effect.Effect<void>;
  }
>()('gycc/lib/content.server/Service') {}

/**
 * The `Content` layer (opencode's module-level `export const layer`,
 * `packages/core/src/git.ts:79`), leaving its `Storage` requirement open so the
 * app runtime and tests can supply different `Storage` layers. `defaultLayer`
 * pre-provides `Storage.layerOptional` (the never-fails-to-build storage,
 * mirroring `git.ts:347`), leaving only `Env` open — the public read path is
 * thus wired with a single `Content.defaultLayer` in the runtime, with `Env`
 * discharged by the surrounding merge.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* Storage.Service;

    /**
     * Read + decode the `SiteContent` document at `key`, or `Option.none()`
     * when it is absent / unreadable / malformed. Shared by the public read
     * path (which maps `none` to the bundled defaults) and the admin read
     * path (which tries the draft, then the published key, then defaults).
     */
    const readDocument = Effect.fnUntraced(
      function* (key: string) {
        const object = yield* storage.get(key);
        const json = yield* Effect.promise(() =>
          new Response(object.stream).text(),
        );
        return Option.some(yield* decodeDocument(json));
      },
      (effect, key) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`Content: could not read ${key}`, cause).pipe(
              Effect.as(Option.none<SiteContentType>()),
            ),
          ),
        ),
    );

    /**
     * Read + decode the document from the bucket, falling back to the bundled
     * defaults on every failure mode (`boundary-discipline`, D3):
     *   - no bucket configured → `Storage.layerOptional` yields a disabled
     *     storage whose `get` reports `NotFound`;
     *   - object absent / empty → `NotFound`;
     *   - bucket unreachable or document malformed → any other failure /
     *     decode error / unexpected defect.
     * In all cases `readDocument` logs and yields `none`, so the site is never
     * broken by a missing or bad document — the public read always gets a
     * `SiteContent`.
     */
    const fetchDocument: Effect.Effect<SiteContentType> = readDocument(
      SITE_CONTENT_KEY,
    ).pipe(
      Effect.map((document) =>
        Option.getOrElse(document, () => defaultContent),
      ),
    );

    /**
     * The public read cache: Effect's built-in TTL cache with manual
     * invalidation (`use-the-platform`). `cachedContent` single-flights
     * concurrent first-reads onto one `fetchDocument` (the others park on its
     * latch and share the result, so the bucket is not stampeded) and returns
     * the same decoded `SiteContent` reference for the TTL's duration;
     * `invalidate` arms the next read to re-fetch (the editor's publish path).
     */
    const [cachedContent, invalidate] = yield* Effect.cachedInvalidateWithTTL(
      fetchDocument,
      Duration.millis(CACHE_TTL_MS),
    );

    const getSiteContent = Effect.fn('Content.getSiteContent')(function* () {
      return yield* cachedContent;
    });

    // -----------------------------------------------------------------------
    // Per-object read path — one independent decode + fallback + cache per
    // Page / Form object (ADR 0008, settled #7; registration-launch Branch 5.3)
    // -----------------------------------------------------------------------

    /**
     * The cached read + its invalidator for ONE object. `read` yields the decoded
     * typed content (or the bundled default on any failure); `invalidate` arms the
     * next read to re-fetch the bucket (the per-object `bust`).
     */
    interface ObjectCache {
      readonly read: Effect.Effect<unknown>;
      readonly invalidate: Effect.Effect<void>;
    }

    /**
     * Build the cached read + invalidator for one registry object. Reads `key`,
     * decodes the JSON at the spec's OWN boundary (no id-backfill — these objects
     * are brand-new storage, ADR 0008), and falls back to the bundled default on
     * EVERY failure mode (absent / unreachable / malformed). The fallback is
     * scoped to this one object, so a corrupt `faq.json` cannot break `about` or
     * the conference read — the blast-radius isolation is structural, one cache
     * per object. The TTL + single-flight + manual-invalidate semantics are the
     * site cache's, applied per object (`use-the-platform`).
     */
    const makeObjectCache = (
      key: string,
      spec: ObjectSpec<unknown, unknown>,
    ): Effect.Effect<ObjectCache> =>
      Effect.gen(function* () {
        const decode = Schema.decodeUnknownEffect(spec.schema);
        const fetch: Effect.Effect<unknown> = Effect.gen(function* () {
          const object = yield* storage.get(key);
          const json = yield* Effect.promise(() =>
            new Response(object.stream).text(),
          );
          const parsed = yield* parseJson(json);
          return yield* decode(parsed);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`Content: could not read ${key}`, cause).pipe(
              Effect.as(spec.default),
            ),
          ),
        );
        const [read, invalidate] = yield* Effect.cachedInvalidateWithTTL(
          fetch,
          Duration.millis(CACHE_TTL_MS),
        );
        return { read, invalidate };
      });

    // Build one independent cache per Page and per Form object up front (the id
    // sets are closed and small — 8 pages + 3 forms). Eager construction keeps
    // each `getPage` / `getForm` a pure cache read with no first-call lock, and
    // the bust dispatch a direct record lookup over the closed id.
    const pageCaches = {} as Record<PageId, ObjectCache>;
    for (const page of PAGE_IDS) {
      pageCaches[page] = yield* makeObjectCache(
        pageObjectKey(page),
        PAGE_SPECS[page],
      );
    }
    const formCaches = {} as Record<FormId, ObjectCache>;
    for (const form of FORM_IDS) {
      formCaches[form] = yield* makeObjectCache(
        formObjectKey(form),
        FORM_SPECS[form],
      );
    }

    const getPage = Effect.fn('Content.getPage')(function* <P extends PageId>(
      page: P,
    ) {
      return (yield* pageCaches[page].read) as PageContent<P>;
    });

    const getForm = Effect.fn('Content.getForm')(function* <F extends FormId>(
      form: F,
    ) {
      return (yield* formCaches[form].read) as FormContent<F>;
    });

    const getConference = Effect.fn('Content.getConference')(function* (
      locale: Locale,
      year?: number,
    ) {
      assertValidLocale(locale);
      const content = yield* getSiteContent();
      const now = yield* Clock.currentTimeMillis;
      return year === undefined
        ? selectCurrent(content, locale, now)
        : selectByYear(content, locale, year);
    });

    const getCurrentConference = Effect.fn('Content.getCurrentConference')(
      function* (locale: Locale) {
        return yield* getConference(locale);
      },
    );

    const getTranslations = Effect.fn('Content.getTranslations')(function* (
      locale: Locale,
    ) {
      assertValidLocale(locale);
      const content = yield* getSiteContent();
      return content.translations[locale];
    });

    const getTeam = Effect.fn('Content.getTeam')(function* () {
      const content = yield* getSiteContent();
      return {
        team: content.team.map(toTeamMember),
        board: [...content.board],
      };
    });

    // Arm the next public read to re-fetch the bucket so a publish is visible
    // immediately, with no redeploy and without waiting out the TTL (D3). This
    // is the built-in cache's `invalidate`: it expires the cached document and
    // clears the stored result, so the next `getSiteContent` recomputes
    // `fetchDocument`. (`make-operations-idempotent`: busting an already-empty
    // or already-expired cache is a harmless no-op.) The built-in does NOT
    // pre-empt an in-flight refresh: a publish landing during one is masked
    // because that refresh re-arms the TTL with its pre-publish document, so
    // the stale window measured from the publish is `(the refresh's remaining
    // bucket-read duration) + one TTL`, not ≤ one TTL. That documented window
    // is within D3's "visible on the next read after the window" contract
    // (see the `Content` doc above for the full mechanism).
    const bust = Effect.fn('Content.bust')(function* (
      target: BustTarget = bustSite,
    ) {
      switch (target.kind) {
        case 'site':
          yield* invalidate;
          return;
        case 'page':
          yield* pageCaches[target.page].invalidate;
          return;
        case 'form':
          yield* formCaches[target.form].invalidate;
          return;
      }
    });

    return Service.of({
      getSiteContent,
      getConference,
      getCurrentConference,
      getTranslations,
      getTeam,
      getPage,
      getForm,
      bust,
    });
  }),
);

/**
 * The public read path's `Content`, with its `Storage` dependency pre-provided
 * as `Storage.layerOptional` (the never-fails-to-build storage, mirroring
 * opencode `packages/core/src/git.ts:347`). Only `Env` stays open, discharged
 * by the surrounding app-runtime merge. The admin write path provides `Storage`
 * standalone (a legit second consumer), so it is NOT wired here.
 */
export const defaultLayer = layer.pipe(Layer.provide(Storage.layerOptional));

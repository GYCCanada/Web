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
import { assetUrl } from './content/asset-url';
import { SiteContent } from './content/schema';
import type {
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
import { root as staticTranslations } from './localization/translations';
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

export interface ConferenceTravelSection {
  readonly enabled: boolean;
  readonly headerCopy: string;
  readonly bodyCopy: string;
  readonly mapEmbedUrl: string | undefined;
}

export interface ConferenceParkingOption {
  readonly title: string;
  readonly link: string | undefined;
  readonly address: string | undefined;
  readonly description: string | undefined;
}

export interface ConferenceParkingSection {
  readonly enabled: boolean;
  readonly headerCopy: string;
  readonly options: readonly ConferenceParkingOption[];
}

export interface ConferenceAccommodationHotel {
  readonly name: string;
  readonly address: string;
  readonly checkIn: string | undefined;
  readonly checkOut: string | undefined;
  readonly roomRates: readonly { readonly description: string }[];
  readonly description: string | undefined;
  readonly navigateUrl: string | undefined;
  readonly reservationUrl: string | undefined;
}

export interface ConferenceAccommodationsSection {
  readonly enabled: boolean;
  readonly headerCopy: string;
  readonly hotels: readonly ConferenceAccommodationHotel[];
}

export interface ConferenceMealsSection {
  readonly enabled: boolean;
  readonly headerCopy: string;
  readonly bodyCopy: string | undefined;
  readonly items: readonly { readonly label: string; readonly price: string }[];
}

export interface ConferenceRegistrationCopySection {
  readonly enabled: boolean;
  readonly title: string;
  readonly subtitle: string;
  readonly buttonLabel: string;
}

export interface ConferenceFaqCopySection {
  readonly enabled: boolean;
  readonly title: string;
  readonly subtitle: string;
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
  readonly registrationUrl: string | undefined;
  readonly scheduleUrl: string | undefined;
  readonly learnMoreEnabled: boolean;
  readonly travel: ConferenceTravelSection;
  readonly parking: ConferenceParkingSection;
  readonly accommodations: ConferenceAccommodationsSection;
  readonly meals: ConferenceMealsSection;
  readonly registrationCopy: ConferenceRegistrationCopySection;
  readonly faqCopy: ConferenceFaqCopySection;
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

// `assetUrl` (key → `/images/<key>`) is the ONE URL-resolution rule, extracted to
// the leaf module `./content/asset-url` so the per-page projection (`pages/project`)
// shares it with no import cycle (`derive-dont-sync`). Imported above.

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

const toConference = (
  conference: DocConference,
  locale: Locale,
): Conference => ({
  slug: conference.slug,
  title: conference.themeName[locale],
  theme: conference.accentColor,
  hero: {
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
  registrationUrl: Option.getOrUndefined(conference.registrationUrl),
  scheduleUrl: Option.getOrUndefined(conference.scheduleUrl),
  learnMoreEnabled: conference.learnMoreEnabled,
  travel: {
    enabled: conference.travel.enabled,
    headerCopy: conference.travel.headerCopy[locale],
    bodyCopy: conference.travel.bodyCopy[locale],
    mapEmbedUrl: Option.getOrUndefined(conference.travel.mapEmbedUrl),
  },
  parking: {
    enabled: conference.parking.enabled,
    headerCopy: conference.parking.headerCopy[locale],
    options: conference.parking.options.map((option) => ({
      title: option.title[locale],
      link: Option.getOrUndefined(option.link),
      address:
        option.address === undefined ? undefined : option.address[locale],
      description:
        option.description === undefined
          ? undefined
          : option.description[locale],
    })),
  },
  accommodations: {
    enabled: conference.accommodations.enabled,
    headerCopy: conference.accommodations.headerCopy[locale],
    hotels: conference.accommodations.hotels.map((hotel) => ({
      name: hotel.name[locale],
      address: hotel.address[locale],
      checkIn:
        hotel.checkIn === undefined ? undefined : hotel.checkIn[locale],
      checkOut:
        hotel.checkOut === undefined ? undefined : hotel.checkOut[locale],
      roomRates: hotel.roomRates.map((rate) => ({
        description: rate.description[locale],
      })),
      description:
        hotel.description === undefined ? undefined : hotel.description[locale],
      navigateUrl: Option.getOrUndefined(hotel.navigateUrl),
      reservationUrl: Option.getOrUndefined(hotel.reservationUrl),
    })),
  },
  meals: {
    enabled: conference.meals.enabled,
    headerCopy: conference.meals.headerCopy[locale],
    bodyCopy:
      conference.meals.bodyCopy === undefined
        ? undefined
        : conference.meals.bodyCopy[locale],
    items: conference.meals.items.map((item) => ({
      label: item.label[locale],
      price: item.price[locale],
    })),
  },
  registrationCopy: {
    enabled: conference.registrationCopy.enabled,
    title: conference.registrationCopy.title[locale],
    subtitle: conference.registrationCopy.subtitle[locale],
    buttonLabel: conference.registrationCopy.buttonLabel[locale],
  },
  faqCopy: {
    enabled: conference.faqCopy.enabled,
    title: conference.faqCopy.title[locale],
    subtitle: conference.faqCopy.subtitle[locale],
  },
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
     * The per-page `enabled` visibility flag for EVERY page, read off the same
     * cached page objects `getPage` reads (Feature C). The nav layout loader folds
     * this into its data so links render data-driven — a page's link appears iff
     * its `enabled` is true — with NO second hardcoded page list (`derive-dont-sync`,
     * the rejected "team-hide nav comment" path). A disabled page's route + action
     * 404 off the same flag (read via `getPage`). Returns a total
     * `Record<PageId, boolean>` over the closed page set; a page whose object is
     * absent/malformed falls back to its bundled default's flag (team's default is
     * `false`, every other is `true`).
     */
    readonly getEnabledPages: () => Effect.Effect<Record<PageId, boolean>>;
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
          // One-shot, idempotent read-boundary backfill (the per-object analogue of
          // `backfillListItemIds`) — fills a structural gap a legacy published
          // object leaves after a new optional field was added (home's
          // `mission.photo`). Absent for specs with no such gap; for ABSENCE only,
          // so a malformed value still reaches `decode` to be rejected.
          const normalized = spec.normalize ? spec.normalize(parsed) : parsed;
          return yield* decode(normalized);
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

    // Read every page's cached object and project to its `enabled` flag — a thin
    // derived read over the SAME per-object caches `getPage` uses (no new cache,
    // no parallel source). The nav drives off this; a disabled page also 404s its
    // route/action off the per-page flag (`derive-dont-sync`).
    const getEnabledPages = Effect.fn('Content.getEnabledPages')(function* () {
      const enabled = {} as Record<PageId, boolean>;
      for (const page of PAGE_IDS) {
        enabled[page] = (yield* getPage(page)).enabled;
      }
      return enabled;
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
      // Static defaults as the BASE, CMS values as OVERRIDES. `content.translations`
      // (from `content/site.json`) is an OPEN `Record`, so an already-published
      // site object NEVER carries a translation key added to the static `root` table
      // after it was published — and `useTranslate` would then return `undefined`
      // (a blank heading/button) until someone republished. Merging `root[locale]`
      // underneath guarantees every static key is present, while a CMS edit to any
      // key still wins. This makes a static translation addition self-applying on
      // deploy with no manual republish (the translation analogue of the per-object
      // read-boundary backfills — `make-operations-idempotent`, `derive-dont-sync`).
      return { ...staticTranslations[locale], ...content.translations[locale] };
    });

    const getTeam = Effect.fn('Content.getTeam')(function* () {
      const content = yield* getSiteContent();
      return {
        team: content.team.map(toTeamMember),
        board: content.board.map((member) => member.name),
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
      getEnabledPages,
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

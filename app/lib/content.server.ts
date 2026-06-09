import {
  Clock,
  Context,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
  Semaphore,
} from 'effect';

import { defaultContent } from './content/defaults';
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
import { Storage } from './storage.server';
import type { ObjectHead } from './storage.server';

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
 *   - `serialize-shared-state-mutations` + `make-operations-idempotent`: a
 *     single-permit `Semaphore` guards the cache refresh so concurrent
 *     first-reads do not stampede the bucket; the holder double-checks the TTL
 *     after acquiring the permit, so a refresh that already happened is not
 *     repeated.
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
const assetUrl = (key: string): string => `/images/${key}`;

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

/** Where the editor's content originated, for the admin banner. */
export type AdminContentSource = 'draft' | 'published' | 'defaults';

export interface AdminContent {
  readonly content: SiteContentType;
  readonly source: AdminContentSource;
}

/**
 * Cache TTL. Short by design (D3 — runtime read with cache, no redeploy): a
 * publish becomes visible on the next read after the TTL elapses (or an
 * explicit bust, added with the editor in C5). 30s keeps the bucket-read rate
 * negligible while making edits feel near-instant.
 */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  readonly value: SiteContentType;
  readonly loadedAt: number;
}

const decodeDocument = Schema.decodeUnknownEffect(Schema.fromJsonString(SiteContent));

export class Content extends Context.Service<
  Content,
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
     * Load the document the `/admin` editor edits: the unpublished draft if one
     * exists, else the published document, else the bundled defaults. Unlike
     * the public read path this is NOT cached and NOT converted to the legacy
     * boundary shape — the editor edits the raw `SiteContent` document.
     */
    readonly getAdminContent: () => Effect.Effect<AdminContent>;
    /**
     * Invalidate the public read cache so the next `getSiteContent` re-reads the
     * bucket. Called by the editor's publish action so a publish is visible
     * immediately, with no redeploy and without waiting out the TTL (D3,
     * `make-operations-idempotent` — busting an already-empty cache is a no-op).
     */
    readonly bust: () => Effect.Effect<void>;
  }
>()('gycc/lib/content.server/Content') {
  static layer = Layer.effect(
    Content,
    Effect.gen(function* () {
      const storage = yield* Storage;
      const cache = yield* Ref.make<Option.Option<CacheEntry>>(Option.none());
      const refreshLock = yield* Semaphore.make(1);
      /**
       * Monotonic publish-epoch counter (`derive-dont-sync`,
       * `serialize-shared-state-mutations`). `bust()` increments it; a refresh
       * snapshots it *before* its bucket read and only commits the freshly-read
       * document to the cache if the epoch is unchanged when it goes to write.
       * This closes the publish/refresh race: a refresh that read the document
       * the bucket held *before* a concurrent publish cannot repopulate the
       * cache with that now-stale document, because the publish's `bust()` will
       * have advanced the epoch in between — the refresh observes the change and
       * leaves the cache empty so the very next read re-fetches the published
       * document (D3 — a publish is visible on the next read, never stale for a
       * full TTL).
       */
      const epoch = yield* Ref.make(0);

      /**
       * Read + decode the document from the bucket, falling back to the bundled
       * defaults on every failure mode (`boundary-discipline`, D3):
       *   - no bucket configured → `Storage.layerOptional` yields a disabled
       *     storage whose `get` reports `NotFound`;
       *   - object absent / empty → `NotFound`;
       *   - bucket unreachable or document malformed → any other failure /
       *     decode error / unexpected defect.
       * In all cases we log and serve the defaults, so the site is never broken
       * by a missing or bad document. `catchCause` recovers from BOTH the typed
       * failures and any defect so the read is total — the public site always
       * gets a `SiteContent`.
       */
      /**
       * Read + decode the `SiteContent` document at `key`, or `Option.none()`
       * when it is absent / unreadable / malformed. Shared by the public read
       * path (which maps `none` to the bundled defaults) and the admin read
       * path (which tries the draft, then the published key, then defaults).
       */
      const readDocument = (
        key: string,
      ): Effect.Effect<Option.Option<SiteContentType>> =>
        Effect.gen(function* () {
          const object = yield* storage.get(key);
          const json = yield* Effect.promise(() =>
            new Response(object.stream).text(),
          );
          return yield* decodeDocument(json);
        }).pipe(
          Effect.map(Option.some),
          Effect.catchCause((cause) =>
            Effect.logWarning(
              `Content: could not read ${key}`,
              cause,
            ).pipe(Effect.as(Option.none<SiteContentType>())),
          ),
        );

      const fetchDocument: Effect.Effect<SiteContentType> = readDocument(
        SITE_CONTENT_KEY,
      ).pipe(
        Effect.map((document) =>
          Option.getOrElse(document, () => defaultContent),
        ),
      );

      /**
       * Return the cached document if it is within the TTL, otherwise refresh
       * it under the single-permit lock. The lock holder re-checks the TTL
       * after acquiring the permit so a refresh that another fiber already
       * completed is not repeated (`make-operations-idempotent`); waiters
       * therefore return the freshly-loaded value without a second bucket read
       * (`serialize-shared-state-mutations`).
       */
      const getSiteContent = (): Effect.Effect<SiteContentType> =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const current = yield* Ref.get(cache);
          if (
            Option.isSome(current) &&
            now - current.value.loadedAt < CACHE_TTL_MS
          ) {
            return current.value.value;
          }

          return yield* refreshLock.withPermits(1)(
            Effect.gen(function* () {
              const afterLock = yield* Ref.get(cache);
              const lockNow = yield* Clock.currentTimeMillis;
              if (
                Option.isSome(afterLock) &&
                lockNow - afterLock.value.loadedAt < CACHE_TTL_MS
              ) {
                return afterLock.value.value;
              }

              // Snapshot the publish epoch *before* reading the bucket. If a
              // concurrent publish busts the cache while this read is in flight,
              // the epoch advances and we must NOT cache the value we just read
              // (it predates the publish). We still return it to *this* caller —
              // it is a coherent decoded document — but we leave the cache empty
              // so the next read re-fetches the published document.
              const readEpoch = yield* Ref.get(epoch);
              const value = yield* fetchDocument;
              const loadedAt = yield* Clock.currentTimeMillis;
              // Commit the cache write only if no bust intervened during the
              // read. `bust()` advances the epoch under the *same* `refreshLock`
              // this fiber holds, so it cannot interleave between this check and
              // the store; a bust that lands while `fetchDocument` is in flight
              // raises the epoch above `readEpoch`, and we skip the write —
              // leaving the cache empty so the next read re-fetches the freshly
              // published document.
              const currentEpoch = yield* Ref.get(epoch);
              if (currentEpoch === readEpoch) {
                yield* Ref.set(cache, Option.some({ value, loadedAt }));
              }
              return value;
            }),
          );
        });

      const getConference = (
        locale: Locale,
        year?: number,
      ): Effect.Effect<Conference> =>
        Effect.gen(function* () {
          assertValidLocale(locale);
          const content = yield* getSiteContent();
          const now = yield* Clock.currentTimeMillis;
          return year === undefined
            ? selectCurrent(content, locale, now)
            : selectByYear(content, locale, year);
        });

      const getCurrentConference = (
        locale: Locale,
      ): Effect.Effect<Conference> => getConference(locale);

      const getTranslations = (locale: Locale): Effect.Effect<Translation> =>
        Effect.gen(function* () {
          assertValidLocale(locale);
          const content = yield* getSiteContent();
          return content.translations[locale];
        });

      const getTeam = () =>
        Effect.gen(function* () {
          const content = yield* getSiteContent();
          return {
            team: content.team.map(toTeamMember),
            board: [...content.board],
          };
        });

      /**
       * Load the document the `/admin` editor edits, reconciling draft vs
       * published by their bucket `lastModified` rather than by the mere
       * *presence* of a draft object (`derive-dont-sync`,
       * `make-impossible-states-unrepresentable`).
       *
       * A draft represents pending unpublished edits **only when it is strictly
       * newer than the published document** — i.e. it was saved after the last
       * publish. The publish path deletes the draft best-effort, but correctness
       * must not depend on that delete succeeding: a draft left behind by a
       * failed delete, or a stale draft that predates the current published doc,
       * is older-or-equal and is therefore ignored, so the editor opens from the
       * published document and a subsequent save/publish can never overwrite the
       * live content with stale draft values. A draft with no published document
       * to compare against is always a valid edit source.
       *
       * (Bucket `lastModified` is second-granular on some backends, so a draft
       * saved and published within the same second compares equal — the strict
       * `>` then drops the ambiguous draft in favour of the just-published live
       * content, the safe direction.)
       */
      const getAdminContent = (): Effect.Effect<AdminContent> =>
        Effect.gen(function* () {
          const draft = yield* readDocument(SITE_CONTENT_DRAFT_KEY);
          const published = yield* readDocument(SITE_CONTENT_KEY);

          if (Option.isSome(draft)) {
            if (Option.isNone(published)) {
              return { content: draft.value, source: 'draft' as const };
            }
            const draftHead = yield* storage
              .head(SITE_CONTENT_DRAFT_KEY)
              .pipe(Effect.orElseSucceed(() => Option.none<ObjectHead>()));
            const publishedHead = yield* storage
              .head(SITE_CONTENT_KEY)
              .pipe(Effect.orElseSucceed(() => Option.none<ObjectHead>()));
            const draftIsNewer =
              Option.isSome(draftHead) &&
              Option.isSome(publishedHead) &&
              draftHead.value.lastModified.getTime() >
                publishedHead.value.lastModified.getTime();
            if (draftIsNewer) {
              return { content: draft.value, source: 'draft' as const };
            }
            return { content: published.value, source: 'published' as const };
          }

          if (Option.isSome(published)) {
            return { content: published.value, source: 'published' as const };
          }
          return { content: defaultContent, source: 'defaults' as const };
        });

      // Drop the cached document AND advance the publish epoch so the next
      // public read re-fetches the bucket (D3 — a publish is visible on the very
      // next read). Both steps run *under* `refreshLock`, the same permit a
      // refresh holds while it reads the bucket and writes the cache. This
      // closes the publish/refresh race (`serialize-shared-state-mutations`): a
      // bust cannot interleave between a refresh's epoch-check and its cache
      // store, so it either runs *before* the refresh snapshots the epoch (the
      // refresh then sees the new bucket document) or *after* the refresh
      // commits — in which case it raises the epoch the refresh had snapshotted
      // and clears the just-cached stale document. Either way the stale,
      // pre-publish document can never survive in the cache.
      // (`make-operations-idempotent`: busting an already-empty cache, or
      // double-busting, is harmless — it just clears `none` and bumps a counter.)
      const bust = (): Effect.Effect<void> =>
        refreshLock.withPermits(1)(
          Effect.gen(function* () {
            yield* Ref.update(epoch, (current) => current + 1);
            yield* Ref.set(cache, Option.none());
          }),
        );

      return Content.of({
        getSiteContent,
        getConference,
        getCurrentConference,
        getTranslations,
        getTeam,
        getAdminContent,
        bust,
      });
    }),
  );
}

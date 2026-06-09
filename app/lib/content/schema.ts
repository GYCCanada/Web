import { Schema } from 'effect';

/**
 * The CMS content model (CMS plan §"Content schema", decisions D2 / D5).
 *
 * One bilingual `SiteContent` document is the single source of truth for every
 * editable piece of the site — the three conferences (2024 / 2025 / 2026), the
 * team, and the ~200 UI translation keys. It is decoded at the boundary by the
 * `Content` service (C3) and authored / published by the `/admin` editor (C5).
 *
 * Modelling principles (see `~/.brain/principles`):
 *   - `make-impossible-states-unrepresentable`: every bilingual field is `Text`
 *     (both locales required, both non-empty); a Conference whose pricing is
 *     undecided carries `registration: Option.none()` rather than empty tuples;
 *     an `accentColor` is a validated `#rrggbb` string, never an arbitrary one.
 *   - `boundary-discipline`: `AssetKey` rejects anything that is not a plain
 *     in-bucket object key (no leading `/`, no URL scheme, no `..` traversal),
 *     so a hand-edited document can never smuggle in a path that escapes the
 *     bucket or points at an absolute URL.
 *   - `use-the-platform`: dates are stored as ISO-8601 `YYYY-MM-DD` strings; the
 *     `Content` boundary (C3) converts them to the existing `[start, end]`
 *     millisecond tuples so route / component code is untouched.
 *
 * The encoded form of this schema IS the JSON stored at `content/site.json`, so
 * every field round-trips losslessly through `encode → JSON → decode` (proven by
 * the C2 round-trip test).
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A bilingual string: both locales required and non-empty. */
export const Text = Schema.Struct({
  en: Schema.NonEmptyString,
  fr: Schema.NonEmptyString,
});
export type Text = typeof Text.Type;

/**
 * A bucket object key (e.g. `2024/speakers/matt.png`). Validated so that a
 * hand-edited document cannot point outside the bucket or at an absolute URL
 * (`boundary-discipline`). The key must be a watertight boundary because C5
 * serves it via `GET /images/*`, where a permissive URL router could
 * percent-decode a smuggled `%2e%2e` back into `..` after this check ran — so
 * the validator forbids the encoding forms outright rather than only the
 * literal ones:
 *   - non-empty;
 *   - no leading `/` (keys are bucket-relative, not absolute paths);
 *   - no URL scheme (`http:`, `data:`, …);
 *   - no backslash `\` (a Windows / alt path separator that segment-splitting on
 *     `/` would not catch, e.g. `a\..\b`);
 *   - no percent sign `%` (so no percent-encoded separator or dot can hide a
 *     `%2e%2e` / `%2f` traversal that a downstream decode would re-materialise —
 *     legitimate in-bucket keys are plain ASCII paths and never need encoding);
 *   - no empty / `.` / `..` path segments (no traversal, no double slashes).
 */
const assetKeyFilter = Schema.makeFilter<string>(
  (key) => {
    if (key.startsWith('/')) return 'AssetKey must not start with "/"';
    if (/^[a-z][a-z0-9+.-]*:/i.test(key)) {
      return 'AssetKey must not contain a URL scheme';
    }
    if (key.includes('\\')) {
      return 'AssetKey must not contain a backslash';
    }
    if (key.includes('%')) {
      return 'AssetKey must not contain a percent-encoded character';
    }
    const segments = key.split('/');
    if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
      return 'AssetKey must not contain empty, "." or ".." segments';
    }
    return undefined;
  },
  { title: 'AssetKey' },
);

export const AssetKey = Schema.NonEmptyString.check(assetKeyFilter);
export type AssetKey = typeof AssetKey.Type;

/**
 * A bilingual pair of bucket keys: the same asset cropped/authored once per
 * locale. Most images are locale-neutral and carry a single `AssetKey`, but the
 * hero artwork is genuinely per-locale today — the source files diverge by
 * locale (e.g. `2025/en/hero-desktop.jpg` *and* `2025/fr/hero-desktop.jpg` are
 * two distinct files on disk, likewise `2026/{en,fr}/hero-desktop.png`).
 * Modelling the key as `{ en, fr }` (mirroring `Text`) keeps both locales'
 * exact paths representable so the rendered `src` survives the boundary
 * untouched (`make-impossible-states-unrepresentable`); a single `AssetKey`
 * here would silently drop one locale's art.
 */
export const LocalizedAssetKey = Schema.Struct({
  en: AssetKey,
  fr: AssetKey,
});
export type LocalizedAssetKey = typeof LocalizedAssetKey.Type;

/** A reference to an image stored in the bucket, with bilingual alt text. */
export const ImageRef = Schema.Struct({
  key: AssetKey,
  alt: Text,
});
export type ImageRef = typeof ImageRef.Type;

/**
 * A single accent colour as a `#rrggbb` hex string (CMS decision D5 — replaces
 * today's misnamed `Conference.theme`, which was the accent colour, not the
 * theme name).
 */
export const HexColour = Schema.NonEmptyString.check(
  Schema.isPattern(/^#[0-9a-fA-F]{6}$/, { title: 'HexColour' }),
);
export type HexColour = typeof HexColour.Type;

/**
 * An ISO-8601 calendar date (`YYYY-MM-DD`). The conference data is day-granular,
 * so the document stores plain dates; the `Content` boundary (C3) widens each to
 * the existing end-of-day-UTC millisecond used by the route code (`use-the-platform`).
 *
 * Two checks, both required (`make-impossible-states-unrepresentable`):
 *   1. the `YYYY-MM-DD` textual shape, and
 *   2. that the components name a *real* calendar day — the pattern alone admits
 *      impossible dates like `2026-99-99`, `2026-02-31`, or a Feb-29 in a
 *      non-leap year, which must never cross the boundary as a typed `IsoDate`.
 * Validity is proven by constructing the UTC date and confirming it round-trips
 * to the same year/month/day (a rolled-over date — e.g. Feb 31 → Mar 3 — differs).
 */
const isoCalendarDateFilter = Schema.makeFilter<string>(
  (value) => {
    // The `^\d{4}-\d{2}-\d{2}$` pattern check runs first, so the slices below
    // are always present and numeric here.
    const year = Number.parseInt(value.slice(0, 4), 10);
    const month = Number.parseInt(value.slice(5, 7), 10);
    const day = Number.parseInt(value.slice(8, 10), 10);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return `IsoDate must be a real calendar date, got "${value}"`;
    }
    return undefined;
  },
  { title: 'IsoDate' },
);

export const IsoDate = Schema.NonEmptyString.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/, { title: 'IsoDate' }),
  isoCalendarDateFilter,
);
export type IsoDate = typeof IsoDate.Type;

/**
 * A `[start, end]` date pair, modelled as a struct so each end is named. The
 * struct-level filter enforces `start <= end` so an inverted range can never
 * cross the boundary (`make-impossible-states-unrepresentable`); because both
 * ends are zero-padded fixed-width `YYYY-MM-DD` strings, lexicographic ordering
 * coincides with chronological ordering, so a plain string compare is exact.
 */
const orderedDateRangeFilter = Schema.makeFilter<{
  readonly start: string;
  readonly end: string;
}>(
  ({ start, end }) =>
    start <= end
      ? undefined
      : `DateRange start (${start}) must not be after end (${end})`,
  { title: 'DateRange' },
);

export const DateRange = Schema.Struct({
  start: IsoDate,
  end: IsoDate,
}).check(orderedDateRangeFilter);
export type DateRange = typeof DateRange.Type;

// ---------------------------------------------------------------------------
// Conference
// ---------------------------------------------------------------------------

/**
 * The three pricing windows. Present together or not at all — a Conference with
 * undecided pricing omits `registration` entirely (see `Conference`).
 */
export const RegistrationWindows = Schema.Struct({
  early: DateRange,
  regular: DateRange,
  late: DateRange,
});
export type RegistrationWindows = typeof RegistrationWindows.Type;

/** A scripture reference; `book` is bilingual (e.g. "John" / "Jean"). */
export const BibleRef = Schema.Struct({
  book: Text,
  chapter: Schema.Int.check(Schema.isGreaterThan(0)),
  verse: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type BibleRef = typeof BibleRef.Type;

/** A plenary speaker: a main-session presenter listed under `speakers`. */
export const Speaker = Schema.Struct({
  name: Text,
  activity: Text,
  photo: ImageRef,
  bio: Text,
});
export type Speaker = typeof Speaker.Type;

/** A breakout seminar and the speaker who leads it. */
export const Seminar = Schema.Struct({
  title: Text,
  speaker: Schema.Struct({
    name: Text,
    photo: ImageRef,
    bio: Text,
  }),
  description: Text,
});
export type Seminar = typeof Seminar.Type;

/**
 * One hero crop: a bilingual pair of bucket keys plus a single bilingual `alt`.
 * The key is `LocalizedAssetKey` because today's hero source diverges by locale
 * (separate `…/en/…` and `…/fr/…` files); the `alt` is locale *text*, not a
 * path, so it stays one bilingual `Text`. The `Content` boundary (C3) selects
 * `key[locale]` to reproduce each locale's exact rendered `src`.
 */
export const HeroImage = Schema.Struct({
  key: LocalizedAssetKey,
  alt: Text,
});
export type HeroImage = typeof HeroImage.Type;

/** The hero artwork: distinct desktop and mobile crops, each with its own alt. */
export const Hero = Schema.Struct({
  desktop: HeroImage,
  mobile: HeroImage,
});
export type Hero = typeof Hero.Type;

/**
 * A single annual conference.
 *
 * `themeName` (the conference title / motto) and `accentColor` (the per-year
 * accent colour) are two distinct fields — CMS decision D5 splits today's
 * misnamed single `theme: string`. `registration` is `Option.none()` when
 * pricing is undecided (2026), never empty tuples
 * (`make-impossible-states-unrepresentable`).
 */
export const Conference = Schema.Struct({
  slug: Schema.NonEmptyString.check(
    Schema.isPattern(/^\/\d{4}$/, { title: 'ConferenceSlug' }),
  ),
  themeName: Text,
  accentColor: HexColour,
  hero: Hero,
  dates: DateRange,
  registration: Schema.OptionFromOptionalKey(RegistrationWindows),
  location: Text,
  tagline: Text,
  bible: BibleRef,
  speakers: Schema.Array(Speaker),
  seminars: Schema.Array(Seminar),
  promos: Schema.Array(Schema.NonEmptyString),
});
export type Conference = typeof Conference.Type;

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

/**
 * A board position. Each value is a translation key whose label lives in
 * `Translations`; constraining to the known set keeps an unknown position
 * unrepresentable and the label single-sourced (`derive-dont-sync`).
 */
export const TeamPosition = Schema.Literals([
  'team.position.president',
  'team.position.vice-president',
  'team.position.vp-logistics',
  'team.position.vp-communications',
  'team.position.vp-networking',
  'team.position.vp-missions',
  'team.position.secretary',
  'team.position.treasurer',
]);
export type TeamPosition = typeof TeamPosition.Type;

/** A member of the executive team (name + position + photo). */
export const TeamMember = Schema.Struct({
  name: Schema.NonEmptyString,
  position: TeamPosition,
  photo: ImageRef,
});
export type TeamMember = typeof TeamMember.Type;

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------

/** A flat map of UI translation keys to their rendered strings, per locale. */
export const TranslationMap = Schema.Record(
  Schema.NonEmptyString,
  Schema.String,
);
export type TranslationMap = typeof TranslationMap.Type;

/** The full bilingual UI translation table. */
export const Translations = Schema.Struct({
  en: TranslationMap,
  fr: TranslationMap,
});
export type Translations = typeof Translations.Type;

// ---------------------------------------------------------------------------
// SiteContent (top level)
// ---------------------------------------------------------------------------

/**
 * Document metadata. `schemaVersion` is a forward-compatibility marker so a
 * future shape change can be migrated rather than guessed at.
 */
export const Meta = Schema.Struct({
  schemaVersion: Schema.Literal(1),
});
export type Meta = typeof Meta.Type;

/**
 * The conference slugs the public routes are built to serve. Each `/YYYY` route
 * (`_index` via `getCurrentConference`, plus the explicit `/2024` `/2025`
 * `/2026` pages via `getConference(locale, year)`) requires its conference to be
 * present in the document; the `SiteContent` filter below rejects any document
 * that omits one. This is the single source of truth for "which conferences the
 * site needs", so the boundary invariant and the routes cannot drift
 * (`derive-dont-sync`).
 */
export const REQUIRED_CONFERENCE_SLUGS = ['/2024', '/2025', '/2026'] as const;

/**
 * The whole editable site as one bilingual document. The encoded form is the
 * JSON stored at `content/site.json`; the decoded form is what the `Content`
 * service hands to the routes (C3).
 *
 * The struct-level filter is the C3 boundary's semantic gate
 * (`make-impossible-states-unrepresentable`, `boundary-discipline`): a document
 * whose `conferences` array decodes cleanly but is empty, or omits one of the
 * slugs the routes serve, is NOT a usable site — the `Content` selectors
 * (`getCurrentConference`, `getConference(year)`) would throw on it downstream
 * of the read pipeline's recovery. Rejecting it HERE (during decode) lets the
 * `Content` service's read-path `catchCause` fall back to the bundled defaults
 * rather than caching a document that 500s the public site on the next request.
 */
const requiredConferencesFilter = Schema.makeFilter<{
  readonly conferences: ReadonlyArray<{ readonly slug: string }>;
}>(
  ({ conferences }) => {
    const present = new Set(conferences.map((conference) => conference.slug));
    const missing = REQUIRED_CONFERENCE_SLUGS.filter(
      (slug) => !present.has(slug),
    );
    return missing.length === 0
      ? undefined
      : `SiteContent must include a conference for each served slug; missing ${missing.join(', ')}`;
  },
  { title: 'SiteContent' },
);

export const SiteContent = Schema.Struct({
  meta: Meta,
  conferences: Schema.Array(Conference),
  team: Schema.Array(TeamMember),
  board: Schema.Array(Schema.NonEmptyString),
  translations: Translations,
}).check(requiredConferencesFilter);
export type SiteContent = typeof SiteContent.Type;

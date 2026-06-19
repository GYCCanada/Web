import { Effect, Schema } from 'effect';

import { AssetKey, ExternalHttpsUrl, ImageRef, ListItemId, Text } from '../schema';

/**
 * The per-Page + per-Form content schemas (ADR 0008, settled #5; registration-launch
 * Branch 5). Each evergreen `Page` (about, faq, give, contact, volunteer, archive,
 * and the home page's non-conference sections) owns ONE typed schema modelling its
 * real structure, stored as its own `content/pages/<page>.json` object. The three
 * forms own a `FormDefinition` object each (`forms/<form>.json`), modelled by the
 * structural field-graph schema in `lib/forms/definition.ts` (Branch 6).
 *
 * Modelling principles (`~/.brain/principles`):
 *   - `make-impossible-states-unrepresentable`: every author-facing string is the
 *     bilingual `Text` (both locales required, non-empty); inline rich copy is a
 *     CLOSED `RichText` token model (text / bold / link), NOT arbitrary HTML, so a
 *     hand-edited page can never smuggle markup into the rendered DOM. A `link`
 *     token's `href` is a validated `LinkHref` (https or mailto only), reusing the
 *     `ExternalHttpsUrl` XSS boundary.
 *   - `boundary-discipline`: list items carry a stable `ListItemId` (ADR 0006) and
 *     live in `IdListArray`s, so FAQ items / give-directions are id-addressable by
 *     the `/admin` editor (Branch 5.5) exactly like speakers and team members.
 *   - `subtract-before-you-add`: these schemas are the typed homes the 352-key flat
 *     translation god-bag's per-page copy migrates into (Branch 5.4); UI-chrome keys
 *     (nav, buttons, form labels) stay in `Translations`.
 *
 * The encoded form of each schema IS the JSON stored at its object key, so every
 * page round-trips losslessly through `encode → JSON → decode` (proven per page in
 * `pages/schema.test.ts`).
 */

// ---------------------------------------------------------------------------
// RichText — a closed inline-token model (NOT arbitrary HTML)
// ---------------------------------------------------------------------------

/**
 * A hyperlink target safe to interpolate into an `href` from hand-edited page
 * content. Either an external `https://` URL (the `ExternalHttpsUrl` brand — the
 * same parse-and-inspect XSS boundary the Conference detail page uses) or a
 * `mailto:` address (the FAQ / contact copy links to `hello@gyccanada.org`). No
 * other scheme is representable, so a `javascript:` / `data:` href can never reach
 * the DOM (`make-impossible-states-unrepresentable`, `boundary-discipline`).
 *
 * Modelled as a union of the `ExternalHttpsUrl` brand and a parse-validated
 * `mailto:` string: the brand keeps the https guarantee load-bearing past the
 * decoder, and the mailto filter parses the URL and requires a non-empty
 * `mailto:` recipient.
 */
const mailtoFilter = Schema.makeFilter<string>(
  (value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return 'MailtoHref must be a valid mailto: URL';
    }
    if (url.protocol !== 'mailto:') {
      return 'MailtoHref must use the mailto: protocol';
    }
    if (url.pathname.trim() === '') {
      return 'MailtoHref must name a recipient';
    }
    return undefined;
  },
  { title: 'MailtoHref' },
);

export const MailtoHref = Schema.NonEmptyString.check(mailtoFilter).pipe(
  Schema.brand('MailtoHref'),
);
export type MailtoHref = typeof MailtoHref.Type;

export const LinkHref = Schema.Union([ExternalHttpsUrl, MailtoHref]);
export type LinkHref = typeof LinkHref.Type;

/**
 * One inline token of rich page copy. A CLOSED discriminated union (`_tag`) over
 * exactly four kinds — the only inline formatting the evergreen pages actually
 * use (plain runs, bold runs, italic runs, and links). A `RichText` value is a
 * *sequence* of these tokens, so "{{before}} registering, please email {{email}} …"
 * round-trips as `[bold('BEFORE'), text(' registering, please email '), link(email), …]`
 * without any HTML ever entering the model — the renderer (Branch 5.4) maps each
 * token to a `<span>` / `<strong>` / `<em>` / `<a>` (`make-impossible-states-unrepresentable`).
 *
 *   - `text`    — a bilingual plain run.
 *   - `bold`    — a bilingual bold run.
 *   - `italic`  — a bilingual emphasized run (the FAQ refund footnote, rendered in
 *     an `<span className="italic">` by the pre-migration route — modelling it as a
 *     token preserves that styling without HTML).
 *   - `link`    — a bilingual label plus a validated `LinkHref` (locale-neutral).
 */
export const RichTextNode = Schema.TaggedUnion({
  text: { value: Text },
  bold: { value: Text },
  italic: { value: Text },
  link: { text: Text, href: LinkHref },
});
export type RichTextNode = typeof RichTextNode.Type;

/** A sequence of inline `RichTextNode`s — closed-token rich copy, never HTML. */
export const RichText = Schema.Array(RichTextNode);
export type RichText = typeof RichText.Type;

/** Construct a plain-`text` `RichText` of a single bilingual run (decoded-`Type` sugar). */
export const richTextOf = (text: Text): RichText => [
  RichTextNode.cases.text.make({ value: text }),
];

// ---------------------------------------------------------------------------
// IdListArray — re-stated locally (matches the SiteContent list discipline)
// ---------------------------------------------------------------------------

/**
 * The unique-`id` invariant shared by every editable list: two items sharing an
 * id would make an id-keyed remove/reorder ambiguous (ADR 0006), so a duplicate is
 * rejected at the boundary. Mirrors `schema.ts`'s `IdListArray` so page lists carry
 * the same identity guarantee as conference / team lists.
 */
const uniqueListItemIds = Schema.makeFilter<
  ReadonlyArray<{ readonly id: string }>
>(
  (items) => {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id)) {
        return `list items must have unique ids; duplicate "${item.id}"`;
      }
      seen.add(item.id);
    }
    return undefined;
  },
  { title: 'uniqueListItemIds' },
);

const IdListArray = <S extends Schema.Codec<{ readonly id: string }, unknown>>(
  item: S,
) => Schema.Array(item).check(uniqueListItemIds);

// ---------------------------------------------------------------------------
// EnabledFlag — the decode-safe per-page visibility boolean (Feature C)
// ---------------------------------------------------------------------------

/**
 * The per-page `enabled` boolean: whether the page is visible in the nav AND
 * routable (a disabled page 404s its public loader + any action it owns, and its
 * nav link is absent). Modelled with `withDecodingDefaultKey(Effect.succeed(true))`
 * so the key is OPTIONAL on the encoded (stored-JSON) side and supplies `true` when
 * absent during decode — an already-published `content/pages/<page>.json` that
 * predates this field still decodes to `enabled: true` (the
 * required-field-on-an-already-published-doc decode hazard the registration launch
 * hit twice — here a `true`-by-default boolean is the honest model: a page is
 * enabled unless explicitly turned off).
 *
 * The default `encodingStrategy: 'passthrough'` writes the flag back on encode, so a
 * re-published object is self-describing (carries its own `enabled`) while a legacy
 * key-less object keeps decoding to `true`. Identical in the strict and draft
 * schemas so a page's draft round-trips the flag (no draft-schema drift). Reused by
 * EVERY page — `derive-dont-sync`, one flag definition.
 */
const EnabledFlag = Schema.Boolean.pipe(
  Schema.withDecodingDefaultKey(Effect.succeed(true)),
);

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * The About page: an ordered list of body paragraphs, a disclaimer line, and an
 * ordered list of attributed quotes. Each paragraph / quote is an id-bearing list
 * item (so the editor can add / remove / reorder paragraphs). A quote's `attribution`
 * is the bilingual source line rendered bold beneath it (today's `about.quote.N` +
 * `about.quote.N.verse`/`.source` pair).
 */
export const AboutPage = Schema.Struct({
  enabled: EnabledFlag,
  title: Text,
  paragraphs: IdListArray(Schema.Struct({ id: ListItemId, text: Text })),
  disclaimer: Text,
  quotes: IdListArray(
    Schema.Struct({ id: ListItemId, text: Text, attribution: Text }),
  ),
});
export type AboutPage = typeof AboutPage.Type;

/**
 * The FAQ page: a Q&A list with inline-link support in the answers (settled #5).
 * `question` is plain bilingual `Text`; `answer` is `RichText` so the existing
 * answers' inline links (`mailto:hello@gyccanada.org`, `gyccanada.org`) and bold
 * runs round-trip without HTML.
 */
export const FaqPage = Schema.Struct({
  enabled: EnabledFlag,
  title: Text,
  items: IdListArray(
    Schema.Struct({ id: ListItemId, question: Text, answer: RichText }),
  ),
});
export type FaqPage = typeof FaqPage.Type;

/**
 * The Give page: a `reason` blurb, an ordered list of give-directions, and the
 * external donate URL (validated `ExternalHttpsUrl` — the PayPal donate link is an
 * author-set string fed straight into an `href`, so it must cross the same XSS
 * boundary as the conference URLs).
 */
export const GivePage = Schema.Struct({
  enabled: EnabledFlag,
  title: Text,
  reason: Text,
  directions: IdListArray(Schema.Struct({ id: ListItemId, text: Text })),
  donateUrl: ExternalHttpsUrl,
});
export type GivePage = typeof GivePage.Type;

/**
 * The Contact page: page COPY only — title + a `directions` line with an inline
 * email link (`RichText`). The form's fields belong to the `FormDefinition`
 * (Branch 6), NOT the Page; keeping Page (copy) and Form (field graph) distinct is
 * the settled boundary (#5, CONTEXT §Page / §Form definition).
 */
export const ContactPage = Schema.Struct({
  enabled: EnabledFlag,
  title: Text,
  directions: RichText,
});
export type ContactPage = typeof ContactPage.Type;

/**
 * The Volunteer page: page COPY only — title (with a bold `movement` run rendered
 * via `RichText`), a subtitle blurb, and the directions heading shown above the
 * form. As with Contact, the form fields belong to the `FormDefinition`, not here.
 */
export const VolunteerPage = Schema.Struct({
  enabled: EnabledFlag,
  title: RichText,
  subtitle: Text,
  directions: Text,
});
export type VolunteerPage = typeof VolunteerPage.Type;

/**
 * The Archive page: a list of past-conference links. The current archive index is
 * empty scaffolding (the only archived year, 2023, is a hand-built route), so the
 * schema models the real future structure — an id-keyed list of `{ label, url }`
 * entries — with an empty default today (section-skip: an empty archive renders
 * nothing). `url` is an `ExternalHttpsUrl` (an archive link may point off-site).
 */
export const ArchivePage = Schema.Struct({
  enabled: EnabledFlag,
  title: Text,
  entries: IdListArray(
    Schema.Struct({ id: ListItemId, label: Text, url: ExternalHttpsUrl }),
  ),
});
export type ArchivePage = typeof ArchivePage.Type;

/**
 * The Home page's EVERGREEN (non-conference) sections (settled #1) — everything on
 * `/` that is NOT the Current Conference hero/countdown (those stay a `Conference`
 * rendered into the route). Models the "mission" blurb, the "join the movement"
 * call-to-action, and the newsletter section copy as bilingual `Text`. Every
 * flat-translation key the god-bag retirement deletes (Branch 5.4) must have a typed
 * home here, or the retirement regresses (plan, Branch 5).
 */
export const HomePage = Schema.Struct({
  enabled: EnabledFlag,
  tagline: Text,
  mission: Schema.Struct({
    readStoryLabel: Text,
    // The mission section's photo — an optional named image slot mirroring the
    // Team page's `groupPhoto` / `portrait` (Feature A): a present photo carries a
    // strict `{ key, alt }` (a valid `AssetKey` + both-locales alt), and an absent
    // slot SECTION-SKIPS in the route (ADR 0008). Kept INSIDE `mission` so the photo
    // travels with the read-story CTA it sits beside, not as a sibling top-level
    // field (`make-impossible-states-unrepresentable`).
    photo: Schema.optionalKey(ImageRef),
  }),
  join: Schema.Struct({
    title: Text,
    subtitle: Text,
    donateLabel: Text,
    volunteerLabel: Text,
  }),
  newsletter: Schema.Struct({
    title: Text,
    subtitle: Text,
    socials: Text,
  }),
});
export type HomePage = typeof HomePage.Type;

/**
 * The Team page CHROME (registration-launch follow-on: the Team route migrated
 * into the per-page CMS model). It owns the page's evergreen copy — the rich
 * title, the subtitle blurb, the board heading — plus TWO named, optional image
 * slots: the group photo banner and the small portrait/logo beside the title.
 *
 * The per-member EXECUTIVE ROSTER (`team[]` / `board[]` on `site.json`, served by
 * `Content.getTeam()`) is conference-executive DATA, not page chrome, and stays
 * where it lives — this schema models only the page's hand-built chrome.
 *
 * Modelling choices (`~/.brain/principles`):
 *   - `title` is `RichText` (not plain `Text`) so the italic `movement` run from
 *     the pre-migration `team.title` / `team.title.movement` pair round-trips as a
 *     closed `italic` token, NOT HTML — exactly as `VolunteerPage.title` does.
 *   - `groupPhoto` / `portrait` are each `Schema.optionalKey(ImageRef)`: two
 *     semantically distinct slots (different aspect / role in the layout), so two
 *     named optional fields beat one list (`make-impossible-states-unrepresentable`).
 *     Optional-at-key means a stored `team.json` that predates either field (or
 *     carries only one uploaded image) still decodes, and the route SECTION-SKIPS
 *     the absent image (ADR 0008) rather than rendering a broken `<img>`. A PRESENT
 *     image carries a strict `{ key, alt }` (a valid `AssetKey` + both-locales alt).
 */
export const TeamPage = Schema.Struct({
  enabled: EnabledFlag,
  title: RichText,
  subtitle: Text,
  boardHeading: Text,
  groupPhoto: Schema.optionalKey(ImageRef),
  portrait: Schema.optionalKey(ImageRef),
});
export type TeamPage = typeof TeamPage.Type;

// ---------------------------------------------------------------------------
// Draft page variants — the laxer admin-draft schemas (ADR 0006, Branch 5.5)
// ---------------------------------------------------------------------------

/**
 * The DRAFT variants of the Pages that carry editable lists (registration-launch
 * Branch 5.5, ADR 0006). "Add item" on a page list (a FAQ entry, a give-direction,
 * an About paragraph/quote, an Archive entry) appends an item carrying ONLY its
 * `id` (settled #10) and auto-saves the draft; the admin then fills the bilingual
 * fields incrementally. The strict page schemas above would reject every such
 * intermediate state (`Text` both-locales-non-empty, a required `ExternalHttpsUrl`
 * on an Archive entry), but ADR 0006 is explicit: an incomplete required field
 * blocks **publish, not draft save**.
 *
 * The tolerance mirrors the site draft (`schema.ts`): a list item's per-locale
 * **content text** relaxes to optional plain strings (`DraftText`) so a half-typed
 * (or untouched-empty) value is draft-valid, while the **identity** (`id`) and any
 * present **branded leaf** (an `ExternalHttpsUrl`) stay strict — the draft tolerates
 * an *absent* value, never a *malformed* one. A `RichText` answer relaxes to
 * `optionalKey` (a freshly-added FAQ item carries no answer until edited); a present
 * answer still decodes through the strict closed-token model.
 *
 * Pages WITHOUT editable lists (`ContactPage`, `VolunteerPage`, `HomePage`) have no
 * add-item flow, so their draft schema IS the strict schema — the registry wires
 * them with `draftSchema === schema` and `DraftEditor` never forks
 * (`make-impossible-states-unrepresentable`: there is no laxer state to represent).
 */
const DraftText = Schema.Struct({
  en: Schema.optionalKey(Schema.String),
  fr: Schema.optionalKey(Schema.String),
});

export const DraftAboutPage = Schema.Struct({
  enabled: EnabledFlag,
  title: Text,
  paragraphs: IdListArray(
    Schema.Struct({ id: ListItemId, text: Schema.optionalKey(DraftText) }),
  ),
  disclaimer: Text,
  quotes: IdListArray(
    Schema.Struct({
      id: ListItemId,
      text: Schema.optionalKey(DraftText),
      attribution: Schema.optionalKey(DraftText),
    }),
  ),
});
export type DraftAboutPage = typeof DraftAboutPage.Type;

export const DraftFaqPage = Schema.Struct({
  enabled: EnabledFlag,
  title: Text,
  items: IdListArray(
    Schema.Struct({
      id: ListItemId,
      question: Schema.optionalKey(DraftText),
      answer: Schema.optionalKey(RichText),
    }),
  ),
});
export type DraftFaqPage = typeof DraftFaqPage.Type;

export const DraftGivePage = Schema.Struct({
  enabled: EnabledFlag,
  title: Text,
  reason: Text,
  directions: IdListArray(
    Schema.Struct({ id: ListItemId, text: Schema.optionalKey(DraftText) }),
  ),
  donateUrl: ExternalHttpsUrl,
});
export type DraftGivePage = typeof DraftGivePage.Type;

export const DraftArchivePage = Schema.Struct({
  enabled: EnabledFlag,
  title: Text,
  entries: IdListArray(
    Schema.Struct({
      id: ListItemId,
      label: Schema.optionalKey(DraftText),
      url: Schema.optionalKey(ExternalHttpsUrl),
    }),
  ),
});
export type DraftArchivePage = typeof DraftArchivePage.Type;

/**
 * A draft image reference for the Team page: a present `key` is still a strict
 * `AssetKey` (an upload always produces a valid one), but `alt` may be unfilled.
 * Mirrors the site draft's `DraftImageRef` (`schema.ts:638`) so the admin can
 * upload the photo FIRST (the action rewrites `groupPhoto.key`) and fill the alt
 * text SECOND — a strict `ImageRef` in the draft would reject the in-between state
 * where a key exists but no alt has been typed (ADR 0006: an incomplete required
 * field blocks PUBLISH, not draft save). Strict publish (`ImageRef`) still requires
 * both halves (`make-impossible-states-unrepresentable` holds for what is set).
 */
const DraftImageRef = Schema.Struct({
  key: Schema.optionalKey(AssetKey),
  alt: Schema.optionalKey(DraftText),
});

/**
 * The DRAFT variant of `TeamPage`. The chrome copy (`title` RichText, `subtitle`,
 * `boardHeading`) has no id-only add flow, so it stays strict — there is no laxer
 * intermediate state to represent for it. Only the two image slots relax (to the
 * lax `DraftImageRef`) so an uploaded `key` can land before its alt text.
 */
export const DraftTeamPage = Schema.Struct({
  enabled: EnabledFlag,
  title: RichText,
  subtitle: Text,
  boardHeading: Text,
  groupPhoto: Schema.optionalKey(DraftImageRef),
  portrait: Schema.optionalKey(DraftImageRef),
});
export type DraftTeamPage = typeof DraftTeamPage.Type;

/**
 * The DRAFT variant of `HomePage` (Feature A pattern, extended to a NESTED image
 * slot). Home has no id-only add-item flow, so every copy field stays strict — the
 * lone reason home needs a draft variant at all is its `mission.photo` slot: an
 * uploaded `key` must be able to land before its alt text (upload-first /
 * fill-alt-second, ADR 0006), which a strict `ImageRef` inside `mission` would
 * reject. So `mission.photo` relaxes to the lax `DraftImageRef`; everything else
 * (`tagline`, `mission.readStoryLabel`, `join.*`, `newsletter.*`) is the strict
 * `Text`, identical to `HomePage`. Unlike Team's two TOP-LEVEL image slots, home's
 * single slot is nested one level under `mission`.
 */
export const DraftHomePage = Schema.Struct({
  enabled: EnabledFlag,
  tagline: Text,
  mission: Schema.Struct({
    readStoryLabel: Text,
    photo: Schema.optionalKey(DraftImageRef),
  }),
  join: Schema.Struct({
    title: Text,
    subtitle: Text,
    donateLabel: Text,
    volunteerLabel: Text,
  }),
  newsletter: Schema.Struct({
    title: Text,
    subtitle: Text,
    socials: Text,
  }),
});
export type DraftHomePage = typeof DraftHomePage.Type;


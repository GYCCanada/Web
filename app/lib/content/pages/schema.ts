import { Schema } from 'effect';

import { ExternalHttpsUrl, ListItemId, Text } from '../schema';

/**
 * The per-Page + per-Form content schemas (ADR 0008, settled #5; registration-launch
 * Branch 5). Each evergreen `Page` (about, faq, give, contact, volunteer, archive,
 * and the home page's non-conference sections) owns ONE typed schema modelling its
 * real structure, stored as its own `content/pages/<page>.json` object. The three
 * forms own a `FormDefinition` object each (`forms/<form>.json`); this slice (5.1)
 * lands a typed PLACEHOLDER for it so the per-form read path (Branch 6) has a real
 * decode boundary, and the structural field-graph schema replaces it in Branch 6.
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
 * exactly three kinds — the only inline formatting the evergreen pages actually
 * use (plain runs, bold runs, and links). A `RichText` value is a *sequence* of
 * these tokens, so "{{before}} registering, please email {{email}} …" round-trips
 * as `[bold('BEFORE'), text(' registering, please email '), link(email), …]`
 * without any HTML ever entering the model — the renderer (Branch 5.4) maps each
 * token to a `<span>` / `<strong>` / `<a>` (`make-impossible-states-unrepresentable`).
 *
 *   - `text`  — a bilingual plain run.
 *   - `bold`  — a bilingual bold run.
 *   - `link`  — a bilingual label plus a validated `LinkHref` (locale-neutral).
 */
export const RichTextNode = Schema.TaggedUnion({
  text: { value: Text },
  bold: { value: Text },
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
  tagline: Text,
  mission: Schema.Struct({
    readStoryLabel: Text,
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

// ---------------------------------------------------------------------------
// FormDefinition — placeholder (Branch 6 replaces with the structural field graph)
// ---------------------------------------------------------------------------

/**
 * A PLACEHOLDER `FormDefinition` schema (registration-launch Branch 5.1). ADR 0007 /
 * Branch 6 build the full structural field-graph (a closed set of ~8 `FieldKind`s,
 * discriminated-union variants, cross-field rules); until then this models only the
 * page-level copy a form object owns — its bilingual title and intro — so Branch 5.3's
 * per-form `getForm` read path has a REAL typed decode boundary to read
 * `forms/<form>.json` through, not a hypothetical. Branch 6 GROWS this schema (adds
 * `fields`) rather than replacing the object, so the per-form storage object and its
 * read path are proven before the field graph lands (`migrate-callers-then-delete`).
 */
export const FormDefinition = Schema.Struct({
  title: Text,
  intro: Schema.optionalKey(Text),
});
export type FormDefinition = typeof FormDefinition.Type;

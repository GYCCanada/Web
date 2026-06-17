import { Schema } from 'effect';

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
import { FormDefinition } from '../../forms/definition';
import {
  AboutPage,
  ArchivePage,
  ContactPage,
  DraftAboutPage,
  DraftArchivePage,
  DraftFaqPage,
  DraftGivePage,
  FaqPage,
  GivePage,
  HomePage,
  VolunteerPage,
} from './schema';
import { type ListItemId } from '../schema';

/**
 * The per-Page + per-Form object REGISTRY (ADR 0008, registration-launch Branch 5.2).
 *
 * Each evergreen Page and each Form definition is its own bucket object
 * (`content/pages/<page>.json`, `forms/<form>.json`). This module is the SINGLE
 * source that maps a closed `PageId` / `FormId` to the three things every consumer
 * of an object needs:
 *
 *   - its **schema** (the decode/encode boundary),
 *   - its bundled **default** (the dev / fallback value, seeded on first publish),
 *   - its storage **keys** (derived from the id — never hand-typed at a call site).
 *
 * Both the `DraftEditor`'s per-object draft/published reconciliation (Branch 5.2)
 * and the `Content` service's multi-object read path (Branch 5.3) resolve through
 * this one registry, so the page/form set is enumerated ONCE (`derive-dont-sync`).
 *
 * Principles (`~/.brain/principles`):
 *   - `make-impossible-states-unrepresentable`: `PageId` / `FormId` are CLOSED
 *     `Schema.Literals`. A scope, a storage key, or a read can only ever name a
 *     page/form that exists — there is no free-string object name.
 *   - `derive-dont-sync`: the storage keys are derived from the id by one
 *     template (`pageObjectKey` / `formObjectKey`); the registry record is the
 *     lone place a new page/form is registered (schema + default), so adding a
 *     Page is one entry, not a scattering of switch arms.
 *   - `subtract-before-you-add`: the registry is keyed by the same closed id set
 *     the `/admin` sections (Branch 5.5) and routes (Branch 5.4) enumerate.
 */

// ---------------------------------------------------------------------------
// Closed id sets
// ---------------------------------------------------------------------------

/**
 * The closed set of evergreen Pages (settled #1, CONTEXT §Page). `home` is the
 * home page's EVERGREEN (non-conference) sections — the Current Conference stays a
 * `Conference` rendered into the route, NOT a Page. Every flat-translation key the
 * god-bag retirement (Branch 5.4) deletes has a typed home in one of these.
 */
export const PageId = Schema.Literals([
  'about',
  'faq',
  'give',
  'contact',
  'volunteer',
  'archive',
  'home',
]);
export type PageId = typeof PageId.Type;

/** Every registered Page id, in declaration order (the read path / admin iterate it). */
export const PAGE_IDS = PageId.literals;

/**
 * The closed set of site Forms (CONTEXT §Form definition). Each owns a
 * `FormDefinition` object (`forms/<form>.json`) — the structural field graph the
 * generic decoder/renderer (Branch 6) read.
 */
export const FormId = Schema.Literals(['contact', 'volunteer', 'registration']);
export type FormId = typeof FormId.Type;

/** Every registered Form id, in declaration order. */
export const FORM_IDS = FormId.literals;

// ---------------------------------------------------------------------------
// Storage-key templates (derived from the id — never hand-typed at a call site)
// ---------------------------------------------------------------------------

/** The published bucket key a Page object lives at (`content/pages/<page>.json`). */
export const pageObjectKey = (page: PageId): string =>
  `content/pages/${page}.json`;

/** The *unpublished* draft key for a Page object (`content/pages/<page>.draft.json`). */
export const pageDraftKey = (page: PageId): string =>
  `content/pages/${page}.draft.json`;

/** The published bucket key a Form definition object lives at (`forms/<form>.json`). */
export const formObjectKey = (form: FormId): string => `forms/${form}.json`;

/** The *unpublished* draft key for a Form definition object (`forms/<form>.draft.json`). */
export const formDraftKey = (form: FormId): string =>
  `forms/${form}.draft.json`;

/**
 * The bucket key one persisted `Submission` lives at
 * (`submissions/<form>/<id>.json`, CONTEXT §Submission, settled #8). Derived from
 * the closed `FormId` plus the submission's `ListItemId` so a persist call can
 * never target a form that doesn't exist nor hand-type the prefix — the same
 * `make-impossible-states-unrepresentable` discipline the page/form key templates
 * carry. The `<form>/` segment groups a form's submissions under one prefix the
 * future first-party registrar (CONTEXT §Submission:47) lists by.
 */
export const submissionKey = (form: FormId, id: ListItemId): string =>
  `submissions/${form}/${id}.json`;

// ---------------------------------------------------------------------------
// Object specs (schema + default per id)
// ---------------------------------------------------------------------------

/**
 * What every consumer of a Page object needs: the schema to decode/encode it
 * through, and the bundled default to fall back to (and seed on first publish).
 * `default` is the *decoded* value (its type is the schema's `Type`), so the
 * record is total over `PageId` with no `unknown` escape hatch.
 *
 * `draftSchema` is the LAXER admin-draft boundary (ADR 0006, Branch 5.5): a page
 * whose `/admin` "Add item" appends an id-only stub (FAQ items, give-directions,
 * About paragraphs/quotes, Archive entries) decodes the *draft* through this — its
 * list items' content fields are optional — while `schema` is the STRICT publish
 * boundary that re-enforces the both-locales `Text` invariant. A page with no
 * add-item flow wires `draftSchema === schema` (there is no laxer state), so
 * `DraftEditor`'s reconciliation never forks: it always reads `draftSchema` for the
 * draft and `schema` for publish (`derive-dont-sync`).
 */
export interface ObjectSpec<A, I> {
  readonly schema: Schema.Codec<A, I>;
  readonly draftSchema: Schema.Codec<unknown, unknown>;
  readonly default: A;
}

/**
 * Build a spec whose draft and publish boundaries DIFFER — the page carries an
 * editable list, so a freshly-added id-only item must be draft-valid (decoded
 * through `draftSchema`) yet publish-invalid until filled (re-decoded through the
 * strict `schema`).
 */
const draftPageSpec = <A, I>(
  schema: Schema.Codec<A, I>,
  draftSchema: Schema.Codec<unknown, unknown>,
  defaultValue: A,
): ObjectSpec<A, I> => ({ schema, draftSchema, default: defaultValue });

/**
 * Build a spec with NO laxer draft variant: the draft boundary IS the strict
 * schema. Used by pages/forms without an add-item flow (contact, volunteer, home,
 * and the form definitions) — there is no id-only intermediate state, so the draft
 * and publish boundaries coincide.
 */
const pageSpec = <A, I>(
  schema: Schema.Codec<A, I>,
  defaultValue: A,
): ObjectSpec<A, I> => ({
  schema,
  draftSchema: schema as Schema.Codec<unknown, unknown>,
  default: defaultValue,
});

/**
 * The Page registry — one entry per `PageId`. The mapped type ties each id to its
 * own schema/default pair (`FaqPage` for `faq`, `AboutPage` for `about`, …), so a
 * lookup is statically the right typed object, not a widened union.
 */
export const PAGE_SPECS = {
  about: draftPageSpec(AboutPage, DraftAboutPage, defaultAboutPage),
  faq: draftPageSpec(FaqPage, DraftFaqPage, defaultFaqPage),
  give: draftPageSpec(GivePage, DraftGivePage, defaultGivePage),
  contact: pageSpec(ContactPage, defaultContactPage),
  volunteer: pageSpec(VolunteerPage, defaultVolunteerPage),
  archive: draftPageSpec(ArchivePage, DraftArchivePage, defaultArchivePage),
  home: pageSpec(HomePage, defaultHomePage),
} as const satisfies { readonly [P in PageId]: ObjectSpec<unknown, unknown> };

/**
 * The Form registry — one entry per `FormId`. Each decodes through the structural
 * `FormDefinition` (Branch 6.1: the closed `FieldKind` set + variants + cross-field
 * rules); the bundled default carries the form's CMS-editable copy with an empty
 * field graph until that form migrates onto the engine (6.3–6.5).
 */
export const FORM_SPECS = {
  contact: pageSpec(FormDefinition, defaultContactForm),
  volunteer: pageSpec(FormDefinition, defaultVolunteerForm),
  registration: pageSpec(FormDefinition, defaultRegistrationForm),
} as const satisfies { readonly [F in FormId]: ObjectSpec<unknown, unknown> };

/** The decoded content type of a Page object, by its id. */
export type PageContent<P extends PageId> = (typeof PAGE_SPECS)[P]['default'];

/** The decoded content type of a Form object, by its id. */
export type FormContent<F extends FormId> = (typeof FORM_SPECS)[F]['default'];

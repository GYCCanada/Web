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
import {
  AboutPage,
  ArchivePage,
  ContactPage,
  FaqPage,
  FormDefinition,
  GivePage,
  HomePage,
  VolunteerPage,
} from './schema';

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
 * `FormDefinition` object (`forms/<form>.json`); Branch 6 grows the placeholder
 * schema into the structural field graph the generic decoder/renderer read.
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

// ---------------------------------------------------------------------------
// Object specs (schema + default per id)
// ---------------------------------------------------------------------------

/**
 * What every consumer of a Page object needs: the schema to decode/encode it
 * through, and the bundled default to fall back to (and seed on first publish).
 * `default` is the *decoded* value (its type is the schema's `Type`), so the
 * record is total over `PageId` with no `unknown` escape hatch.
 */
export interface ObjectSpec<A, I> {
  readonly schema: Schema.Codec<A, I>;
  readonly default: A;
}

const pageSpec = <A, I>(
  schema: Schema.Codec<A, I>,
  defaultValue: A,
): ObjectSpec<A, I> => ({ schema, default: defaultValue });

/**
 * The Page registry — one entry per `PageId`. The mapped type ties each id to its
 * own schema/default pair (`FaqPage` for `faq`, `AboutPage` for `about`, …), so a
 * lookup is statically the right typed object, not a widened union.
 */
export const PAGE_SPECS = {
  about: pageSpec(AboutPage, defaultAboutPage),
  faq: pageSpec(FaqPage, defaultFaqPage),
  give: pageSpec(GivePage, defaultGivePage),
  contact: pageSpec(ContactPage, defaultContactPage),
  volunteer: pageSpec(VolunteerPage, defaultVolunteerPage),
  archive: pageSpec(ArchivePage, defaultArchivePage),
  home: pageSpec(HomePage, defaultHomePage),
} as const satisfies { readonly [P in PageId]: ObjectSpec<unknown, unknown> };

/**
 * The Form registry — one entry per `FormId`. Each is the placeholder
 * `FormDefinition` today (Branch 5.1); Branch 6 grows the schema, leaving this
 * registry's shape unchanged.
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

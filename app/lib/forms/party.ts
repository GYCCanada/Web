import { Schema } from 'effect';

import { Text } from '../content/schema';
import { MessageKey } from './tokens';

/**
 * The CMS-authored PARTY SECTION (registrar plan Decision 2b) — a top-level
 * authored section that rides on `FormDefinition` as a fifth `optionalKey`
 * sibling of `title`/`fields`/`variant`/`rules`/`pricing`. It is NOT a ninth
 * `FieldKind`: a party scope is decoded ONCE per submission (like the shell),
 * never enters a `FieldList`, never widens the hand-written `FieldKindShape`
 * mirror in `definition.ts`. The section declares the *available* billing modes
 * (the allow-list) plus all of the selector/payer chrome — labels and message
 * keys — so no party copy lives in route-static JSX (Constraint 4).
 *
 * Modelling principles (`~/.brain/principles`):
 *   - `make-impossible-states-unrepresentable`: the authored payer is an
 *     `optionalKey` sub-struct, and the `FormDefinition` integrity filter (folded
 *     into the combined `.check`) enforces the biconditional
 *     `'group' ∈ billingMode.options keys ⟺ payer present` — a `perRegistrant`-only
 *     form cannot author a dead payer block, and a `group`-offering form cannot
 *     omit it.
 *   - `derive-dont-sync`: every message key is a `MessageKey`, validated at the
 *     boundary against the live `translations` object (a new `registration.party.*`
 *     token must ship in `translations.ts` first — proven in the party-scope spike).
 *
 * The encoded form of this schema IS the JSON stored under `party` in
 * `forms/registration.json`, authored/localized through the same `deepMerge`
 * path as every other form section.
 */

/**
 * The closed billing-mode token set. ONE definition; reused by the party
 * section's authored allow-list AND (later) the route-owned shell codec +
 * `PaymentState.mode`.
 */
export const BillingMode = Schema.Literals(['group', 'perRegistrant']);
export type BillingMode = typeof BillingMode.Type;

/**
 * The mode-selector's authored options must offer at least one mode — a party
 * section that offers zero billing modes is meaningless. Mirrors the array-based
 * `nonEmptyOptions` on a `literal` field (`definition.ts:96-102`), but runs over
 * the keyed-struct option set: an ABSENT key means that mode is not offered (the
 * allow-list), so "non-empty" is "≥1 key present".
 */
const nonEmptyOptions = Schema.makeFilter<{
  readonly group?: unknown;
  readonly perRegistrant?: unknown;
}>(
  (options) =>
    Object.keys(options).length > 0
      ? undefined
      : 'a party billing-mode selector must offer at least one mode',
  { title: 'BillingMode.nonEmptyOptions' },
);

/**
 * The party-level mode selector. Options are a STRUCT of `optionalKey` known
 * modes (NOT `Schema.Record(BillingMode, Text)` — verified: a `Record` over
 * `Schema.Literals` REQUIRES all literal keys in effect beta.60, so it cannot
 * model a group-only allow-list; and NOT an array — `itemIdentity` keys on
 * `id`/`slug` only (`admin-form.ts:152-156`), so an array of `{value,label}`
 * silently drops label edits). A keyed object struct merges natively through
 * `deepMerge`'s object branch; an ABSENT key means that mode is not offered (the
 * allow-list). The value is `Text` directly, so the authoring/edit path is
 * `party.billingMode.options.group.en` (NOT `...options.group.label.en`).
 * Proven in `app/lib/forms/party-scope-spike.test.ts`.
 */
const BillingModeSelector = Schema.Struct({
  label: Text, // the radio-group legend (CMS Text, no deploy)
  requiredMessage: MessageKey, // emitted on an off-list/smuggled mode (token ships in C7a)
  options: Schema.Struct({
    // allow-list: an absent key ⇒ that mode is not offered
    group: Schema.optionalKey(Text),
    perRegistrant: Schema.optionalKey(Text),
  }).check(nonEmptyOptions), // ≥1 mode authored
});

/**
 * The nominated payer's authored chrome — labels + message keys for a name+email
 * contact. A fixed sub-struct (NOT an open `FieldList`): a payer is exactly an
 * addressable receipt recipient, so the shape is closed
 * (`make-impossible-states-unrepresentable`). The payer may be a non-attendee
 * (a parent paying for a youth group), so it is its own identity, not
 * `registrants[0]`.
 */
const PayerFields = Schema.Struct({
  label: Text, // block heading ("Who is paying?")
  nameField: Schema.Struct({ label: Text, requiredMessage: MessageKey }),
  emailField: Schema.Struct({
    label: Text,
    requiredMessage: MessageKey,
    invalidMessage: MessageKey,
  }),
});
export type PayerFields = typeof PayerFields.Type;

/**
 * The CMS-authored PARTY SECTION — a sibling of `fields`/`variant`/`rules`
 * (`optionalKey`, backfill-safe). Present ⇒ multi-party (registration); absent ⇒
 * single-submission (contact/volunteer). `payer` is `optionalKey`; the
 * `FormDefinition` integrity filter enforces the biconditional
 * `'group' ∈ options keys ⟺ payer present` so there is no dead/meaningless
 * authored payer.
 */
export const PartySection = Schema.Struct({
  intro: Schema.optionalKey(Text),
  billingMode: BillingModeSelector,
  payer: Schema.optionalKey(PayerFields),
});
export type PartySection = typeof PartySection.Type;

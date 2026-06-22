import { Schema } from 'effect';

import { Text } from '../content/schema';
import { PartySection } from './party';
import { PricingRules } from './pricing';
import { FieldName, MessageKey, OptionValue } from './tokens';

/**
 * The structural `FormDefinition` schema (ADR 0007, CONTEXT §Form definition;
 * registration-launch Branch 6). A `FormDefinition` is **data** — the JSON object
 * stored at `forms/<form>.json` — describing one of the site's three forms
 * (contact, volunteer, registration): its fields, their kinds (drawn from a
 * CLOSED set), their bilingual labels/placeholders, the discriminated-union
 * variants some forms branch on, and the cross-field requirement rules that no
 * single-field check can express. A generic renderer (Branch 6.2) turns it into
 * the rendered form; a generic decoder (Branch 6.2) reconstructs server-side
 * Effect Schema validation from it. This module (Branch 6.1) lands ONLY the
 * schema + the closed kind-set + its round-trip / closure tests — the renderer,
 * decoder, and the contact/volunteer/registration field-graphs migrate in later
 * sub-commits (6.2–6.5).
 *
 * It replaces the page-level-copy-only PLACEHOLDER that lived in
 * `content/pages/schema.ts` (Branch 5.1): every consumer (the per-form registry,
 * the bundled form defaults, `Content.getForm`) is migrated to this module and
 * the placeholder is deleted (`migrate-callers-then-delete-legacy-apis`,
 * `subtract-before-you-add`). The `title` / `intro` copy fields are preserved so
 * the placeholder objects still decode and a form keeps a CMS-editable heading.
 *
 * Modelling principles (`~/.brain/principles`):
 *   - `make-impossible-states-unrepresentable`: `FieldKind` is a CLOSED tagged
 *     union over exactly the eight kinds the three forms use — a `FormDefinition`
 *     cannot invent an arbitrary field type (CONTEXT §Form definition). Every
 *     author-facing string is the bilingual `Text` (both locales required,
 *     non-empty). Every validation-failure message is a `MessageKey` — a real
 *     `TranslationKey` validated at the boundary — so a hand-edited definition
 *     can never reference an error key that renders blank (`FieldErrors` renders
 *     each message through `translate()`).
 *   - `boundary-discipline`: a field's submit-name (`FieldName`) is a constrained
 *     identifier, never an arbitrary string, so it is safe to interpolate into a
 *     form-data path; a literal `option` value is likewise a constrained token.
 *   - `derive-dont-sync`: `MessageKey`'s valid set IS the `translations` object,
 *     consulted at decode time — never a re-declared copy of the key list.
 *
 * The encoded form of this schema IS the JSON stored at `forms/<form>.json`, so a
 * definition round-trips losslessly through `encode → JSON → decode` (proven in
 * `definition.test.ts`).
 */

// ---------------------------------------------------------------------------
// Leaf brands — message keys, field names, literal option tokens
// ---------------------------------------------------------------------------

// `FieldName` / `OptionValue` / `MessageKey` are defined in the leaf `tokens.ts`
// (shared with `pricing.ts` AND `party.ts` without an import cycle — `party`
// keys its chrome off `MessageKey`, so a `definition ↔ party` mutual import
// would otherwise hit a module-init temporal-dead-zone on the brand) and
// re-exported here so every existing importer (`decode`, `render`, the admin
// routes, the party-scope spike) keeps importing them from `definition`. They
// are also imported above for use in this module's schemas.
export { FieldName, MessageKey, OptionValue } from './tokens';

/**
 * One selectable option of a `literal` / `arrayOfLiteral` field: its submitted
 * `value` token plus its bilingual `label` (what the radio / checkbox shows).
 */
export const FieldOption = Schema.Struct({
  value: OptionValue,
  label: Text,
});
export type FieldOption = typeof FieldOption.Type;

/** A non-empty list of options — a `literal` field with zero choices is meaningless. */
const nonEmptyOptions = Schema.makeFilter<ReadonlyArray<unknown>>(
  (options) =>
    options.length > 0
      ? undefined
      : 'a literal field must offer at least one option',
  { title: 'OptionList' },
);

const OptionList = Schema.Array(FieldOption).check(nonEmptyOptions);

/**
 * A non-negative integer bound for a `number` field (`min` / `max`): a count is
 * never fractional and never below zero (`Schema.Int.check(isGreaterThanOrEqual
 * To(0))`, the same brand idiom `pricing.ts`'s `Cents` uses). Quantity pricing
 * multiplies a clamped count by a per-unit `Cents`, so a fractional or negative
 * bound is meaningless (`make-impossible-states-unrepresentable`).
 */
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

// ---------------------------------------------------------------------------
// FieldKind — the CLOSED set of field kinds
// ---------------------------------------------------------------------------

/**
 * The recursive decoded shape of a `FieldKind` — hand-written so `Schema.suspend`
 * (used for the `nestedGroup` self-reference) has an explicit target; a tagged
 * union cannot infer through its own recursion. Mirrors the `FieldKind` schema
 * below member-for-member.
 */
type FieldChrome<Name, Txt> = {
  readonly name: Name;
  readonly label: Txt;
  readonly placeholder?: Txt;
};
type FieldKindShape<Name, Txt, Msg, Opt, Bool, Num> =
  | ({
      readonly _tag: 'requiredText';
      readonly optional?: Bool;
      readonly multiline?: Bool;
      readonly requiredMessage: Msg;
    } & FieldChrome<Name, Txt>)
  | ({
      readonly _tag: 'optionalText';
      readonly multiline?: Bool;
      readonly requirePresent?: Bool;
      readonly invalidMessage: Msg;
    } & FieldChrome<Name, Txt>)
  | ({
      readonly _tag: 'email';
      readonly optional?: Bool;
      readonly requiredMessage: Msg;
      readonly invalidMessage: Msg;
    } & FieldChrome<Name, Txt>)
  | ({
      readonly _tag: 'url';
      readonly optional?: Bool;
      readonly requiredMessage: Msg;
      readonly invalidMessage: Msg;
    } & FieldChrome<Name, Txt>)
  | ({
      readonly _tag: 'literal';
      readonly options: ReadonlyArray<{ readonly value: Opt; readonly label: Txt }>;
      readonly requiredMessage: Msg;
    } & FieldChrome<Name, Txt>)
  | ({
      readonly _tag: 'checkboxBoolean';
      readonly optional?: Bool;
      readonly requiredMessage: Msg;
    } & FieldChrome<Name, Txt>)
  | ({
      readonly _tag: 'number';
      readonly optional?: Bool;
      readonly min?: Num;
      readonly max?: Num;
      readonly requiredMessage: Msg;
      readonly invalidMessage: Msg;
    } & FieldChrome<Name, Txt>)
  | ({
      readonly _tag: 'arrayOfLiteral';
      readonly options: ReadonlyArray<{ readonly value: Opt; readonly label: Txt }>;
      readonly requiredMessage: Msg;
    } & FieldChrome<Name, Txt>)
  | {
      readonly _tag: 'nestedGroup';
      readonly name: Name;
      readonly label: Txt;
      readonly optional?: Bool;
      readonly presenceAnchor?: Name;
      readonly fields: ReadonlyArray<
        FieldKindShape<Name, Txt, Msg, Opt, Bool, Num>
      >;
    };

/** The decoded `FieldKind` (brands load-bearing). */
export type FieldKind = FieldKindShape<
  FieldName,
  Text,
  MessageKey,
  OptionValue,
  boolean,
  number
>;
/** The encoded `FieldKind` — the JSON shape (brands erased to plain strings). */
type FieldKindEncoded = FieldKindShape<
  string,
  { readonly en: string; readonly fr: string },
  string,
  string,
  boolean,
  number
>;

/**
 * The unique-submit-name invariant shared by every field list: two fields sharing
 * a `name` would collide in the decoded payload and the rendered form, so a
 * duplicate is rejected at the boundary (`make-impossible-states-unrepresentable`).
 */
const uniqueFieldNames = Schema.makeFilter<
  ReadonlyArray<{ readonly name: string }>
>(
  (fields) => {
    const seen = new Set<string>();
    for (const field of fields) {
      if (seen.has(field.name)) {
        return `field names must be unique; duplicate "${field.name}"`;
      }
      seen.add(field.name);
    }
    return undefined;
  },
  { title: 'uniqueFieldNames' },
);

/**
 * Shared author copy carried by every leaf field: its submit-name, its bilingual
 * `label`, and an optional bilingual `placeholder`. Spread into each kind below.
 */
const fieldChrome = {
  name: FieldName,
  label: Text,
  placeholder: Schema.optionalKey(Text),
} as const;

/**
 * `FieldKind` — the CLOSED, specified set of field kinds (CONTEXT §Form
 * definition, ADR 0007). A tagged union (`_tag`) over exactly eight leaf /
 * structural kinds; a `FormDefinition` cannot invent a ninth
 * (`make-impossible-states-unrepresentable`). Each carries the `MessageKey`s the
 * decoder emits on that kind's failure paths — every failure has a real
 * translation key by construction.
 *
 *   - `requiredText`    — a non-empty free-text field (the empty, absent, and
 *     non-string cases all emit `requiredMessage`). `optional: true` makes the
 *     field optional-at-key (absence valid, never a missing-key error) while a
 *     PRESENT value is still non-empty (an empty string emits `requiredMessage`):
 *     the cross-field-gated text whose presence a rule governs but which still
 *     rejects a visibly-blank value (contact/volunteer `phone`).
 *     `multiline: true` is a pure PRESENTATION flag (the renderer draws a
 *     `<textarea>` instead of an `<input>`); it does NOT change decode — a
 *     multiline value is the same non-empty string (the contact `message`, the
 *     volunteer free-text fields).
 *   - `optionalText`    — a present-but-empty-allowed free-text field (the old
 *     zod-permissive "other notes"); a present non-string emits `invalidMessage`,
 *     an empty string is always valid. `multiline` renders a `<textarea>`
 *     (presentation only, like `requiredText`). The `requirePresent` flag selects
 *     between the TWO distinct oracle behaviours the kind must reproduce, never
 *     collapse:
 *       - `requirePresent` absent/false → genuinely OPTIONAL-at-key (an absent key
 *         is valid, emits nothing). Mirrors the oracle's `OptionalString`
 *         (`Schema.optional(Schema.String…)`) — registration's `church`,
 *         `instrument`, `dietaryRestrictions`.
 *       - `requirePresent: true` → KEY-MUST-BE-PRESENT, empty-string-allowed: an
 *         absent key emits `invalidMessage`, a present empty string is valid.
 *         Mirrors the oracle's `OptionalText`
 *         (`Schema.String…annotateKey({ messageMissingKey })`, NOT optional) —
 *         registration's `extra.other`, where the always-rendered `extra` block
 *         POSTs an empty `other`, so an ABSENT `other` inside a present `extra` is
 *         an out-of-form payload the oracle (and now the engine) reject.
 *   - `email`           — a required email; emptiness/absence emit
 *     `requiredMessage`, a malformed address emits `invalidMessage`. `optional:
 *     true` makes it optional-at-key but NON-EMPTY-when-present (the empty present
 *     value still emits `requiredMessage`): the `method`-gated contact/volunteer
 *     `email` whose presence a `requiredWhenEquals` rule governs.
 *   - `url`             — a required absolute URL; emptiness/absence emit
 *     `requiredMessage`, an unparseable value emits `invalidMessage`. `optional:
 *     true` makes it optional-at-key but non-empty-when-present, mirroring `email`.
 *   - `literal`         — a single choice from a closed `OptionList` (a radio /
 *     select); an off-list or absent value emits `requiredMessage`.
 *   - `checkboxBoolean` — a `true` / `false` / `on` checkbox-boolean; an off-token
 *     or absent value emits `requiredMessage`. `optional: true` makes an unchecked
 *     (absent) box valid (the volunteer single-checkboxes).
 *   - `number`          — a non-negative integer count (a quantity field): an
 *     absent/empty value emits `requiredMessage`, a non-integer / out-of-range
 *     value emits `invalidMessage`. `optional: true` makes an absent key valid (a
 *     count not entered); `min`/`max` are inclusive integer bounds. The
 *     `quantity` pricing rule multiplies a `clamp(qty, 0, max)` by a per-unit
 *     `Cents` (`price.ts`); the kind is what `pricingReferencesResolve` requires a
 *     `quantity` rule's `field` to be.
 *   - `arrayOfLiteral`  — a multi-select over a closed `OptionList`; an off-list
 *     element or absent array emits `requiredMessage`.
 *   - `nestedGroup`     — a sub-struct of further `FieldKind`s (the `parent`,
 *     `extra`, and `volunteer` groups registration nests). Recursive via
 *     `Schema.suspend`. `optional: true` makes the WHOLE group present-validate /
 *     absent-ok: a conditionally-rendered group (registration's minors-only
 *     `parent`, the opt-in `volunteer`) the enclosing variant must NOT demand when
 *     absent, but whose inner fields still run their full checks WHEN the group is
 *     present (`Schema.optional(Parent)` / `Schema.optional(Volunteer)` in the
 *     oracle). An absent non-optional group inside a selected variant is an error
 *     (the always-rendered `extra` group); an absent `optional` group is valid.
 *     `presenceAnchor` names which inner field that absent-group error attributes
 *     to (registration's `extra` → `tos`, the oracle's `['extra','tos']` anchor);
 *     omitted, it defaults to the group's first presence-requirable inner field.
 *
 * Two ORTHOGONAL optionality axes, never conflated:
 *   - WHICH FIELDS APPEAR for a registrant (an exhibitor-only field on an
 *     attendee) is the enclosing `variant`'s concern, not a per-kind flag.
 *   - PRESENCE-AT-KEY of a field that always appears but whose value may be
 *     absent (the `method`-gated contact/volunteer `email`/`phone`, present only
 *     when the user picks that contact method) is the `optional: true` flag on
 *     `requiredText`/`email`/`url`. Crucially `optional` governs ONLY whether the
 *     key may be ABSENT; a PRESENT value still runs the kind's full non-empty +
 *     format checks (an `optional` email with value `""` still emits its
 *     `requiredMessage`). This is what makes a `requiredWhenEquals` rule's target
 *     model the oracle exactly — the rule re-imposes PRESENCE when triggered, the
 *     field forbids a visibly-blank PRESENT value either way
 *     (`make-impossible-states-unrepresentable`: a blank-but-present required
 *     value is not representable as valid). There is still no "required: false"
 *     knob that would let a present value skip its checks.
 */
export const FieldKind = Schema.TaggedUnion({
  requiredText: {
    ...fieldChrome,
    optional: Schema.optionalKey(Schema.Boolean),
    multiline: Schema.optionalKey(Schema.Boolean),
    requiredMessage: MessageKey,
  },
  optionalText: {
    ...fieldChrome,
    multiline: Schema.optionalKey(Schema.Boolean),
    requirePresent: Schema.optionalKey(Schema.Boolean),
    invalidMessage: MessageKey,
  },
  email: {
    ...fieldChrome,
    optional: Schema.optionalKey(Schema.Boolean),
    requiredMessage: MessageKey,
    invalidMessage: MessageKey,
  },
  url: {
    ...fieldChrome,
    optional: Schema.optionalKey(Schema.Boolean),
    requiredMessage: MessageKey,
    invalidMessage: MessageKey,
  },
  literal: { ...fieldChrome, options: OptionList, requiredMessage: MessageKey },
  checkboxBoolean: {
    ...fieldChrome,
    optional: Schema.optionalKey(Schema.Boolean),
    requiredMessage: MessageKey,
  },
  number: {
    ...fieldChrome,
    optional: Schema.optionalKey(Schema.Boolean),
    // Inclusive integer bounds the quantity is clamped/validated against. Both
    // are non-negative integers (a count is never below zero, never fractional);
    // `optionalKey` so a bound is omitted when unconstrained on that side. The
    // `from <= to` ordering is not asserted here (a single-sided bound is the
    // common case); `price()`'s `clamp(qty, 0, max)` is total regardless.
    min: Schema.optionalKey(NonNegativeInt),
    max: Schema.optionalKey(NonNegativeInt),
    requiredMessage: MessageKey,
    invalidMessage: MessageKey,
  },
  arrayOfLiteral: {
    ...fieldChrome,
    options: OptionList,
    requiredMessage: MessageKey,
  },
  nestedGroup: {
    name: FieldName,
    label: Text,
    optional: Schema.optionalKey(Schema.Boolean),
    // When a NON-optional group is omitted whole from a selected variant, the
    // engine must surface a real key SOMEWHERE inside it; `presenceAnchor` names
    // WHICH inner field that key attributes to (registration's `extra` anchors at
    // `tos`, matching the oracle's `['extra','tos']`). Absent → the group's first
    // presence-requirable inner field (the back-compatible default). The named
    // field must exist in `fields` and be presence-requirable; `groupPresenceIssue`
    // validates this at decode time. Declared data, not a positional coincidence
    // (`derive-dont-sync`, `make-impossible-states-unrepresentable`).
    presenceAnchor: Schema.optionalKey(FieldName),
    fields: Schema.Array(
      Schema.suspend(
        (): Schema.Codec<FieldKind, FieldKindEncoded> => FieldKind,
      ),
    ).check(uniqueFieldNames),
  },
});

/**
 * A list of fields — the body of a `FormDefinition`, a `nestedGroup`, and a
 * variant — with unique submit-names.
 */
export const FieldList = Schema.Array(FieldKind).check(uniqueFieldNames);
export type FieldList = typeof FieldList.Type;

// ---------------------------------------------------------------------------
// Variants — discriminated-union support
// ---------------------------------------------------------------------------

/** A non-empty list of variants is meaningless below two members. */
const atLeastTwoVariants = Schema.makeFilter<ReadonlyArray<unknown>>(
  (variants) =>
    variants.length >= 2
      ? undefined
      : 'a variant set must offer at least two variants',
  { title: 'FormVariantSet.variants' },
);

/**
 * The discriminator's `options` and its `variants` describe ONE closed
 * value-set seen from two sides: each selectable option MUST have exactly one
 * variant branch, and each branch MUST be reachable by exactly one option
 * (`make-impossible-states-unrepresentable`). Without this bijection a
 * definition could decode with a selectable radio that branches to no fields
 * (an option with no variant), an unreachable branch (a variant with no
 * option), or a duplicate value collapsing two entries on either side — all
 * impossible states the renderer/decoder (Branch 6.2) would have to special-case
 * downstream. Asserted as a struct-level filter (it needs both arrays) over the
 * decoded `OptionValue` tokens, mirroring `DateRange`'s ordered-pair filter in
 * `content/schema.ts`.
 */
const variantsMatchOptions = Schema.makeFilter<{
  readonly options: ReadonlyArray<{ readonly value: string }>;
  readonly variants: ReadonlyArray<{ readonly value: string }>;
}>(
  ({ options, variants }) => {
    const optionValues = options.map((option) => option.value);
    const variantValues = variants.map((variant) => variant.value);

    const optionSet = new Set(optionValues);
    if (optionSet.size !== optionValues.length) {
      return 'discriminator options must not repeat a value';
    }
    const variantSet = new Set(variantValues);
    if (variantSet.size !== variantValues.length) {
      return 'variant branches must not repeat a value';
    }

    for (const value of optionValues) {
      if (!variantSet.has(value)) {
        return `discriminator option "${value}" has no matching variant branch`;
      }
    }
    for (const value of variantValues) {
      if (!optionSet.has(value)) {
        return `variant branch "${value}" has no matching discriminator option`;
      }
    }
    return undefined;
  },
  { title: 'FormVariantSet.variantsMatchOptions' },
);

/**
 * A single variant of a discriminated form section: the discriminator `value`
 * that selects it (e.g. `"attendee"`), its bilingual `label` (the radio option),
 * and the `fields` that exist ONLY in that variant. Registration's
 * attendee/exhibitor split is two `FormVariant`s.
 */
export const FormVariant = Schema.Struct({
  value: OptionValue,
  label: Text,
  fields: FieldList,
});
export type FormVariant = typeof FormVariant.Type;

/**
 * A discriminated-union section of a form (CONTEXT §Form definition): a
 * `discriminator` submit-name, the closed set of `options` it selects between,
 * and the `requiredMessage` for an absent/off-list discriminator value. The
 * common fields of the section live in the enclosing `FormDefinition.fields`; the
 * variant-specific fields live in each `FormVariant`. A form with no
 * discriminated section omits `variant` entirely (contact's `method` is a
 * cross-field rule over a `literal`, not a structural variant — only registration
 * structurally varies its field set).
 */
export const FormVariantSet = Schema.Struct({
  discriminator: FieldName,
  options: OptionList,
  requiredMessage: MessageKey,
  variants: Schema.Array(FormVariant).check(atLeastTwoVariants),
}).check(variantsMatchOptions);
export type FormVariantSet = typeof FormVariantSet.Type;

// ---------------------------------------------------------------------------
// Cross-field rules
// ---------------------------------------------------------------------------

/** `requiredWhenEquals` must name at least one trigger value. */
const nonEmptyEquals = Schema.makeFilter<ReadonlyArray<unknown>>(
  (values) =>
    values.length > 0
      ? undefined
      : 'requiredWhenEquals must name at least one trigger value',
  { title: 'requiredWhenEquals.equals' },
);

/** An `activeWhen` literal/array predicate must name at least one trigger value. */
const nonEmptyActivationValues = Schema.makeFilter<ReadonlyArray<unknown>>(
  (values) =>
    values.length > 0
      ? undefined
      : 'activeWhen must name at least one trigger value',
  { title: 'ActiveWhen.values' },
);

/**
 * The CLOSED activation predicate of an `activeWhenEquals` rule (registrar plan
 * Decision 5). Activation — does a field render / get required / get priced —
 * is keyed off a SIBLING's chosen value, but the trigger is not always a single
 * literal equality: it must also cover a multi-select gate and a checkbox gate.
 * A tagged union over exactly the three predicate shapes the engine evaluates
 * (`make-impossible-states-unrepresentable` — a definition cannot invent a
 * fourth):
 *
 *   - `literalEquals`    — the `when` `literal` equals one of `equals`;
 *   - `arrayIncludesAny` — the `when` `arrayOfLiteral` includes one of `values`;
 *   - `checkboxChecked`  — the `when` `checkboxBoolean` is checked (`true`).
 *
 * The decode-time integrity filter (`rulesReferToExistingFields`) proves each
 * arm's `when` names an existing field of the matching kind, in the SAME scope
 * as the rule's `target`, and that every `equals`/`values` token is one of that
 * field's options — so the runtime evaluator (`activation.ts`) reads the decoded
 * value with no further guarding.
 */
export const ActiveWhen = Schema.TaggedUnion({
  literalEquals: {
    when: FieldName,
    equals: Schema.Array(OptionValue).check(nonEmptyActivationValues),
  },
  arrayIncludesAny: {
    when: FieldName,
    values: Schema.Array(OptionValue).check(nonEmptyActivationValues),
  },
  checkboxChecked: {
    when: FieldName,
  },
});
export type ActiveWhen = typeof ActiveWhen.Type;

/**
 * A CLOSED set of cross-field requirement rules — the validity no single-field
 * check can express (CONTEXT §Form definition). Two kinds:
 *
 *   - `requiredWhenEquals` — the `target` field is required when the `when` field
 *     equals one of `equals` (e.g. contact's email is required when `method` is
 *     `email` or `both`); the failure emits `message` at the `target` path.
 *   - `activeWhenEquals` — the `target` field is ACTIVE (rendered, presence-
 *     required, price-eligible) only when its `predicate` holds over a sibling;
 *     absent ⇒ always active (registrar plan Decision 5). Activation has no
 *     failure message of its OWN — it GATES other checks (render hides an
 *     inactive field, the decoder skips its presence requirement, `price()`
 *     contributes 0), so it carries no `message`. A PRESENT value for an inactive
 *     target is an out-of-form payload the decoder rejects at the target's path
 *     (`decode.ts`).
 *
 * Modelled as a tagged union so a later rule kind is a new variant, never a
 * free-form predicate string (`make-impossible-states-unrepresentable`).
 */
export const CrossFieldRule = Schema.TaggedUnion({
  requiredWhenEquals: {
    when: FieldName,
    equals: Schema.Array(OptionValue).check(nonEmptyEquals),
    target: FieldName,
    message: MessageKey,
  },
  activeWhenEquals: {
    predicate: ActiveWhen,
    target: FieldName,
  },
});
export type CrossFieldRule = typeof CrossFieldRule.Type;

// ---------------------------------------------------------------------------
// FormDefinition
// ---------------------------------------------------------------------------

/**
 * The encoded shape a pricing-reference walk needs from each field: its `_tag`,
 * its `name`, the `options` of a `literal` / `arrayOfLiteral`, and the nested
 * `fields` of a `nestedGroup`. A loose structural mirror (the filter runs on the
 * ENCODED `FormDefinition`, pre-brand, exactly like `variantsMatchOptions`).
 */
type EncodedFieldNode = {
  readonly _tag: string;
  readonly name: string;
  readonly options?: ReadonlyArray<{ readonly value: string }>;
  readonly fields?: ReadonlyArray<EncodedFieldNode>;
};

/**
 * A pricing rule keyed to a field/option that does not exist — or to a field of
 * the wrong kind — is a `derive-dont-sync` drift the SEPARATE-pricing-structure
 * design (Decision 1) closes at the decode boundary, exactly as
 * `variantsMatchOptions` closes the discriminator bijection. The filter walks the
 * full field graph (top-level `fields`, recursively through `nestedGroup`, and
 * every `variant` branch), builds `name → _tag` and `literal/array name →
 * Set<optionValue>` indexes, then checks each rule:
 *   - `choice` ⇒ its `field` is a `literal`, and every priced `option` is one of
 *     that field's options;
 *   - `multiChoice` ⇒ its `field` is an `arrayOfLiteral`, every priced `option`
 *     in its options;
 *   - `toggle` ⇒ its `field` is a `checkboxBoolean`;
 *   - `quantity` ⇒ its `field` is a `number` (C9 — the per-unit count rule).
 * A rule naming a missing field, a kind mismatch, or an off-list option is a hard
 * decode error — pricing drift becomes a decode-time impossibility.
 */
const pricingReferencesResolve = Schema.makeFilter<{
  readonly fields: ReadonlyArray<EncodedFieldNode>;
  readonly variant?: { readonly variants: ReadonlyArray<{ readonly fields: ReadonlyArray<EncodedFieldNode> }> };
  readonly pricing?: {
    readonly rules: ReadonlyArray<
      | { readonly _tag: 'choice'; readonly field: string; readonly prices: ReadonlyArray<{ readonly option: string }> }
      | { readonly _tag: 'multiChoice'; readonly field: string; readonly prices: ReadonlyArray<{ readonly option: string }> }
      | { readonly _tag: 'toggle'; readonly field: string }
      | { readonly _tag: 'quantity'; readonly field: string }
    >;
  };
}>(
  (def) => {
    if (def.pricing === undefined) {
      return undefined;
    }

    const kindByName = new Map<string, string>();
    const optionsByName = new Map<string, ReadonlySet<string>>();

    const walk = (nodes: ReadonlyArray<EncodedFieldNode>): void => {
      for (const node of nodes) {
        kindByName.set(node.name, node._tag);
        if (
          (node._tag === 'literal' || node._tag === 'arrayOfLiteral') &&
          node.options !== undefined
        ) {
          optionsByName.set(
            node.name,
            new Set(node.options.map((option) => option.value)),
          );
        }
        if (node._tag === 'nestedGroup' && node.fields !== undefined) {
          walk(node.fields);
        }
      }
    };

    walk(def.fields);
    for (const branch of def.variant?.variants ?? []) {
      walk(branch.fields);
    }

    for (const rule of def.pricing.rules) {
      const kind = kindByName.get(rule.field);
      if (kind === undefined) {
        return `pricing rule references unknown field "${rule.field}"`;
      }
      if (rule._tag === 'toggle') {
        if (kind !== 'checkboxBoolean') {
          return `toggle pricing rule "${rule.field}" must target a checkboxBoolean field, not "${kind}"`;
        }
        continue;
      }
      if (rule._tag === 'quantity') {
        if (kind !== 'number') {
          return `quantity pricing rule "${rule.field}" must target a number field, not "${kind}"`;
        }
        continue;
      }
      // `choice` ⇒ literal, `multiChoice` ⇒ arrayOfLiteral.
      const expectedKind = rule._tag === 'choice' ? 'literal' : 'arrayOfLiteral';
      if (kind !== expectedKind) {
        return `${rule._tag} pricing rule "${rule.field}" must target a ${expectedKind} field, not "${kind}"`;
      }
      const options = optionsByName.get(rule.field) ?? new Set<string>();
      for (const price of rule.prices) {
        if (!options.has(price.option)) {
          return `pricing rule "${rule.field}" prices unknown option "${price.option}"`;
        }
      }
    }

    return undefined;
  },
  { title: 'FormDefinition.pricingReferencesResolve' },
);

/**
 * The encoded shape a cross-field-rule reference walk needs from each rule — a
 * loose structural mirror of the two `CrossFieldRule` arms on the ENCODED
 * (pre-brand) `FormDefinition`, exactly like `EncodedFieldNode` mirrors a field.
 */
type EncodedCrossFieldRule =
  | {
      readonly _tag: 'requiredWhenEquals';
      readonly when: string;
      readonly equals: ReadonlyArray<string>;
      readonly target: string;
    }
  | {
      readonly _tag: 'activeWhenEquals';
      readonly predicate:
        | { readonly _tag: 'literalEquals'; readonly when: string; readonly equals: ReadonlyArray<string> }
        | { readonly _tag: 'arrayIncludesAny'; readonly when: string; readonly values: ReadonlyArray<string> }
        | { readonly _tag: 'checkboxChecked'; readonly when: string };
      readonly target: string;
    };

/**
 * One flat decoded namespace ("scope") cross-field rules resolve against: a
 * `name → _tag` index plus a `literal`/`arrayOfLiteral` `name → Set<option>`
 * index over the fields that decode into the SAME struct. The top-level scope is
 * the top-level `fields` PLUS the discriminator PLUS every variant branch's
 * fields (the decoder flattens all of them into one struct, `decode.ts`); each
 * `nestedGroup`'s inner fields form their own scope.
 */
type RuleScope = {
  readonly kindByName: ReadonlyMap<string, string>;
  readonly optionsByName: ReadonlyMap<string, ReadonlySet<string>>;
};

/**
 * Cross-field rules (`requiredWhenEquals` AND `activeWhenEquals`) that name a
 * field which does not exist, a `when` of the wrong kind, an off-list trigger
 * value, a `target`/`when` in DIFFERENT scopes, a self-reference, or a cycle are
 * a `derive-dont-sync` drift this filter closes at the decode boundary — exactly
 * as `variantsMatchOptions`/`pricingReferencesResolve` close their bijections.
 * It also closes the PRE-EXISTING `requiredWhenEquals` integrity gap (until now
 * a rule could name a dangling field and decode happily).
 *
 * Scope is SAME-SCOPE-SIBLING-ONLY (v1, registrar plan Decision 5): a rule's
 * `when` and `target` must live in the same flat decoded namespace. The
 * top-level scope unifies the top-level fields, the discriminator, and every
 * variant branch's fields (the decoder flattens them into one struct, so a rule
 * `when: <discriminator>` / `target: <branch field>` IS same-scope — the
 * existing registration `type`→`dateOfBirth` rule relies on this); each
 * `nestedGroup`'s inner fields form a separate scope. Enclosing-scope and
 * cross-branch references are deferred — rejected here.
 */
const rulesReferToExistingFields = Schema.makeFilter<{
  readonly fields: ReadonlyArray<EncodedFieldNode>;
  readonly variant?: {
    readonly discriminator: string;
    readonly options: ReadonlyArray<{ readonly value: string }>;
    readonly variants: ReadonlyArray<{
      readonly fields: ReadonlyArray<EncodedFieldNode>;
    }>;
  };
  readonly rules?: ReadonlyArray<EncodedCrossFieldRule>;
}>(
  (def) => {
    if (def.rules === undefined || def.rules.length === 0) {
      return undefined;
    }

    // Build the set of independent scopes a rule may resolve within. The
    // top-level scope unifies the top-level fields, the discriminator, and every
    // variant branch's fields; each nestedGroup contributes a further scope.
    const scopes: Array<{ kindByName: Map<string, string>; optionsByName: Map<string, Set<string>> }> = [];

    const collect = (
      nodes: ReadonlyArray<EncodedFieldNode>,
      scope: { kindByName: Map<string, string>; optionsByName: Map<string, Set<string>> },
    ): void => {
      for (const node of nodes) {
        scope.kindByName.set(node.name, node._tag);
        if (
          (node._tag === 'literal' || node._tag === 'arrayOfLiteral') &&
          node.options !== undefined
        ) {
          scope.optionsByName.set(
            node.name,
            new Set(node.options.map((option) => option.value)),
          );
        }
        if (node._tag === 'nestedGroup' && node.fields !== undefined) {
          const groupScope = { kindByName: new Map<string, string>(), optionsByName: new Map<string, Set<string>>() };
          scopes.push(groupScope);
          collect(node.fields, groupScope);
        }
      }
    };

    const topScope = { kindByName: new Map<string, string>(), optionsByName: new Map<string, Set<string>>() };
    scopes.push(topScope);
    collect(def.fields, topScope);
    if (def.variant !== undefined) {
      // The discriminator decodes as a `literal` over its `options` — model it as
      // such so a rule may key off it (the registration `type`→`dateOfBirth` rule).
      topScope.kindByName.set(def.variant.discriminator, 'literal');
      topScope.optionsByName.set(
        def.variant.discriminator,
        new Set(def.variant.options.map((option) => option.value)),
      );
      for (const branch of def.variant.variants) {
        collect(branch.fields, topScope);
      }
    }

    /** The scope a field name belongs to, or `undefined` if it exists nowhere. */
    const scopeOf = (name: string): RuleScope | undefined =>
      scopes.find((scope) => scope.kindByName.has(name));

    for (const rule of def.rules) {
      if (rule._tag === 'requiredWhenEquals') {
        const scope = scopeOf(rule.target);
        if (scope === undefined) {
          return `cross-field rule references unknown target field "${rule.target}"`;
        }
        const whenKind = scope.kindByName.get(rule.when);
        if (whenKind === undefined) {
          return `requiredWhenEquals "when" field "${rule.when}" does not exist in the same scope as target "${rule.target}"`;
        }
        if (rule.when === rule.target) {
          return `cross-field rule "when" and "target" must differ ("${rule.when}")`;
        }
        // A literal/arrayOfLiteral `when` constrains `equals` to its options; a
        // checkbox/text `when` carries no option set (the trigger is its value).
        const options = scope.optionsByName.get(rule.when);
        if (options !== undefined) {
          for (const value of rule.equals) {
            if (!options.has(value)) {
              return `requiredWhenEquals "when" field "${rule.when}" has no option "${value}"`;
            }
          }
        }
        continue;
      }

      // activeWhenEquals — `target` is gated by `predicate` over a sibling `when`.
      const scope = scopeOf(rule.target);
      if (scope === undefined) {
        return `activeWhenEquals references unknown target field "${rule.target}"`;
      }
      const predicate = rule.predicate;
      const whenKind = scope.kindByName.get(predicate.when);
      if (whenKind === undefined) {
        return `activeWhenEquals "when" field "${predicate.when}" does not exist in the same scope as target "${rule.target}"`;
      }
      if (predicate.when === rule.target) {
        return `activeWhenEquals "when" and "target" must differ ("${predicate.when}")`;
      }
      switch (predicate._tag) {
        case 'literalEquals': {
          if (whenKind !== 'literal') {
            return `activeWhenEquals literalEquals "when" field "${predicate.when}" must be a literal, not "${whenKind}"`;
          }
          const options = scope.optionsByName.get(predicate.when) ?? new Set<string>();
          for (const value of predicate.equals) {
            if (!options.has(value)) {
              return `activeWhenEquals "when" field "${predicate.when}" has no option "${value}"`;
            }
          }
          break;
        }
        case 'arrayIncludesAny': {
          if (whenKind !== 'arrayOfLiteral') {
            return `activeWhenEquals arrayIncludesAny "when" field "${predicate.when}" must be an arrayOfLiteral, not "${whenKind}"`;
          }
          const options = scope.optionsByName.get(predicate.when) ?? new Set<string>();
          for (const value of predicate.values) {
            if (!options.has(value)) {
              return `activeWhenEquals "when" field "${predicate.when}" has no option "${value}"`;
            }
          }
          break;
        }
        case 'checkboxChecked': {
          if (whenKind !== 'checkboxBoolean') {
            return `activeWhenEquals checkboxChecked "when" field "${predicate.when}" must be a checkboxBoolean, not "${whenKind}"`;
          }
          break;
        }
      }
    }

    // Cycle check (v1, same-scope): an activation chain A→B→…→A is rejected. The
    // edge is target → predicate.when (the target depends ON its trigger); a
    // back-edge closing a loop is a cycle. requiredWhenEquals is presence-only —
    // it does not gate activation, so it is excluded from the activation graph.
    const activationEdges = new Map<string, string>();
    for (const rule of def.rules) {
      if (rule._tag === 'activeWhenEquals') {
        activationEdges.set(rule.target, rule.predicate.when);
      }
    }
    for (const start of activationEdges.keys()) {
      const seen = new Set<string>();
      let node: string | undefined = start;
      while (node !== undefined) {
        if (seen.has(node)) {
          return `activeWhenEquals rules form a cycle through "${node}"`;
        }
        seen.add(node);
        node = activationEdges.get(node);
      }
    }

    return undefined;
  },
  { title: 'FormDefinition.rulesReferToExistingFields' },
);

/**
 * The party-scope integrity biconditional (registrar plan Decision 2b.2): a
 * `group`-offering form MUST author a payer block, and a `perRegistrant`-only
 * form MUST NOT — otherwise the authored payer is either missing (a `group` form
 * with no receipt-recipient chrome) or dead (a `perRegistrant`-only form with
 * meaningless payer copy). Folded into the combined `FormDefinition.check`
 * (composed, not chained — Risk 6) so it accumulates alongside the pricing/rule
 * integrity walks. Runs on the ENCODED `party` (pre-brand), exactly like the
 * other `FormDefinition` filters; a definition with no `party` is inert (the
 * shared schema — contact/volunteer/registration — must all keep decoding).
 *
 * The biconditional is `'group' ∈ Object.keys(party.billingMode.options) ⟺
 * party.payer !== undefined`. Enforcement that `party` itself is registration-only
 * is a CONSUMER concern (only the registration route reads it), NOT a per-form
 * schema guard — all three forms share this one schema with no `FormId` context,
 * mirroring the `variant` precedent (Decision 2b, OQ2).
 */
const partyPayerBiconditional = Schema.makeFilter<{
  readonly party?: {
    readonly billingMode: { readonly options: Record<string, unknown> };
    readonly payer?: unknown;
  };
}>(
  (def) => {
    if (def.party === undefined) {
      return undefined;
    }
    const offersGroup = 'group' in def.party.billingMode.options;
    const hasPayer = def.party.payer !== undefined;
    if (offersGroup && !hasPayer) {
      return 'a party offering the "group" billing mode must author a payer block';
    }
    if (!offersGroup && hasPayer) {
      return 'a party that does not offer the "group" billing mode must not author a payer block';
    }
    return undefined;
  },
  { title: 'FormDefinition.partyPayerBiconditional' },
);

/**
 * The full structural definition of one site form (ADR 0007). `title` / `intro`
 * are the CMS-editable page copy carried over from the Branch 5.1 placeholder;
 * `fields` is the common field graph; `variant` is the optional discriminated
 * section; `rules` are the cross-field requirements; `pricing` is the optional
 * pricing dimension (Decision 1/3 — `optionalKey`, absence ⇒ unpriced); `party`
 * is the optional CMS-authored party section (Decision 2b — the billing-mode
 * allow-list + payer chrome; `optionalKey`, absence ⇒ single-submission). A form
 * whose fields are not yet authored (the post-migration default before its graph
 * lands) carries an empty `fields` and no `variant` / `rules` / `pricing` /
 * `party`.
 *
 * `pricing` is `optionalKey` so every already-published `forms/*.json` (contact,
 * volunteer, registration — all decode through this one schema) keeps decoding
 * unchanged; the `pricingReferencesResolve` `.check` guards the keyed-structure
 * design against drift at the boundary (a rule naming a missing field/option, or
 * a kind mismatch, is a hard decode error). The composed `rulesReferToExisting
 * Fields` `.check` does the same for BOTH cross-field-rule kinds — a dangling
 * `when`/`target`, a wrong `when` kind, an off-list trigger value, an out-of-
 * scope reference, a self-reference, or an activation cycle is a hard decode
 * error (registrar plan Decision 5; also closes the pre-existing
 * `requiredWhenEquals` integrity gap).
 */
export const FormDefinition = Schema.Struct({
  title: Text,
  intro: Schema.optionalKey(Text),
  fields: FieldList,
  variant: Schema.optionalKey(FormVariantSet),
  rules: Schema.optionalKey(Schema.Array(CrossFieldRule)),
  pricing: Schema.optionalKey(PricingRules),
  party: Schema.optionalKey(PartySection),
}).check(
  pricingReferencesResolve,
  rulesReferToExistingFields,
  partyPayerBiconditional,
);
export type FormDefinition = typeof FormDefinition.Type;

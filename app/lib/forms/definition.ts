import { Schema } from 'effect';

import { Text } from '../content/schema';
import { root } from '../localization/translations';

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

/** The closed set of valid translation keys, consulted at decode time. */
const TRANSLATION_KEYS: ReadonlySet<string> = new Set(Object.keys(root.en));

const messageKeyFilter = Schema.makeFilter<string>(
  (key) =>
    TRANSLATION_KEYS.has(key)
      ? undefined
      : `MessageKey must be a known TranslationKey; "${key}" is not in translations`,
  { title: 'MessageKey' },
);

/**
 * A form-validation error message: a real `TranslationKey`, validated at the
 * boundary against the live `translations` object (`derive-dont-sync`). The
 * generic decoder (Branch 6.2) emits these keys verbatim on each failure path, so
 * an off-list key would render blank in `FieldErrors` — it is rejected here
 * instead (`make-impossible-states-unrepresentable`). The brand keeps the
 * guarantee load-bearing past the decoder; the generic decoder (Branch 6.2)
 * hands a decoded `MessageKey` to `translate()` knowing the boundary already
 * proved it is a real `TranslationKey`.
 */
export const MessageKey = Schema.NonEmptyString.check(messageKeyFilter).pipe(
  Schema.brand('MessageKey'),
);
export type MessageKey = typeof MessageKey.Type;

/**
 * A field's submit-name — the key the browser POSTs and the path segment the
 * decoder addresses. Constrained to a JS-identifier-like token (`a-z`, `A-Z`,
 * `0-9`, `_`) so a hand-edited definition cannot smuggle a dotted path, a `[`, or
 * whitespace into a name the decoder interpolates into a form-data path
 * (`boundary-discipline`).
 */
export const FieldName = Schema.NonEmptyString.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/, { title: 'FieldName' }),
).pipe(Schema.brand('FieldName'));
export type FieldName = typeof FieldName.Type;

/**
 * A `literal` / `arrayOfLiteral` option value — the token submitted when an
 * option is chosen (e.g. `"attendee"`, `"t-shirt"`, `"male"`). A constrained
 * token (no whitespace, the URL-safe-ish set) so it is safe in a radio `value`
 * and an off-list value is a hard decode error in the generated codec.
 */
export const OptionValue = Schema.NonEmptyString.check(
  Schema.isPattern(/^[A-Za-z0-9_-]+$/, { title: 'OptionValue' }),
).pipe(Schema.brand('OptionValue'));
export type OptionValue = typeof OptionValue.Type;

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
type FieldKindShape<Name, Txt, Msg, Opt, Bool> =
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
      readonly _tag: 'arrayOfLiteral';
      readonly options: ReadonlyArray<{ readonly value: Opt; readonly label: Txt }>;
      readonly requiredMessage: Msg;
    } & FieldChrome<Name, Txt>)
  | {
      readonly _tag: 'nestedGroup';
      readonly name: Name;
      readonly label: Txt;
      readonly optional?: Bool;
      readonly fields: ReadonlyArray<FieldKindShape<Name, Txt, Msg, Opt, Bool>>;
    };

/** The decoded `FieldKind` (brands load-bearing). */
export type FieldKind = FieldKindShape<
  FieldName,
  Text,
  MessageKey,
  OptionValue,
  boolean
>;
/** The encoded `FieldKind` — the JSON shape (brands erased to plain strings). */
type FieldKindEncoded = FieldKindShape<
  string,
  { readonly en: string; readonly fr: string },
  string,
  string,
  boolean
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
  arrayOfLiteral: {
    ...fieldChrome,
    options: OptionList,
    requiredMessage: MessageKey,
  },
  nestedGroup: {
    name: FieldName,
    label: Text,
    optional: Schema.optionalKey(Schema.Boolean),
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

/**
 * A CLOSED set of cross-field requirement rules — the validity no single-field
 * check can express (CONTEXT §Form definition). One kind today:
 *
 *   - `requiredWhenEquals` — the `target` field is required when the `when` field
 *     equals one of `equals` (e.g. contact's email is required when `method` is
 *     `email` or `both`); the failure emits `message` at the `target` path.
 *
 * Modelled as a tagged union so a later rule kind (e.g. `requiredWhenPresent`) is
 * a new variant, never a free-form predicate string
 * (`make-impossible-states-unrepresentable`).
 */
export const CrossFieldRule = Schema.TaggedUnion({
  requiredWhenEquals: {
    when: FieldName,
    equals: Schema.Array(OptionValue).check(nonEmptyEquals),
    target: FieldName,
    message: MessageKey,
  },
});
export type CrossFieldRule = typeof CrossFieldRule.Type;

// ---------------------------------------------------------------------------
// FormDefinition
// ---------------------------------------------------------------------------

/**
 * The full structural definition of one site form (ADR 0007). `title` / `intro`
 * are the CMS-editable page copy carried over from the Branch 5.1 placeholder;
 * `fields` is the common field graph; `variant` is the optional discriminated
 * section; `rules` are the cross-field requirements. A form whose fields are not
 * yet authored (the post-migration default before its graph lands) carries an
 * empty `fields` and no `variant` / `rules`.
 */
export const FormDefinition = Schema.Struct({
  title: Text,
  intro: Schema.optionalKey(Text),
  fields: FieldList,
  variant: Schema.optionalKey(FormVariantSet),
  rules: Schema.optionalKey(Schema.Array(CrossFieldRule)),
});
export type FormDefinition = typeof FormDefinition.Type;

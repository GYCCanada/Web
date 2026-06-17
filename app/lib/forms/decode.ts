import { Result, Schema, SchemaGetter } from 'effect';
import type { Issue } from 'effect/SchemaIssue';

import type {
  CrossFieldRule,
  FieldKind,
  FormDefinition,
  FormVariantSet,
  MessageKey,
} from './definition';

/**
 * The generic form decoder (ADR 0007, CONTEXT §Form definition; registration-
 * launch Branch 6.2). Reconstructs the server-side Effect Schema validation of a
 * form FROM its `FormDefinition` data — the same validation the three hand-tuned
 * schemas (`contact.tsx`, `volunteer.tsx`, `registration-schema.ts`) express by
 * hand today. Branches 6.3–6.5 migrate those callers onto this decoder behind an
 * equivalence harness; this sub-commit lands the decoder + its own tests.
 *
 * Why a built schema rather than an ad-hoc validator: the existing form pipeline
 * (`parseSchema` / `formatSchemaResult` in `~/lib/effect/form-schema`) already
 * turns an Effect Schema `Issue` tree into conform's `{ formErrors, fieldErrors }`
 * buckets keyed by `formatPath`. By compiling a `FormDefinition` into a real
 * `Schema.Struct`, the decoder reuses that boundary verbatim — the generated
 * codec emits an `Issue` tree exactly like the hand-written schemas do, so the
 * error PATHS and KEYS the harness asserts come from one shared mechanism
 * (`derive-dont-sync`, `subtract-before-you-add`). The decoder does not re-invent
 * path serialization or message bucketing.
 *
 * Behaviour the generated schema reproduces, transcribed from the hand-tuned
 * siblings so the migration is byte-equivalent (the annotation idiom is fixed by
 * `contact.tsx:47-109` / `registration-schema.ts:69-114`):
 *   - a leaf's empty-string / absent / invalid-type cases all emit a real
 *     `MessageKey` (`.check(isMinLength(1, { message }))` for empty, a node-level
 *     `.annotate({ message })` for the invalid type a duplicate field name POSTs
 *     as an array, `.annotateKey({ messageMissingKey })` for the absent key);
 *   - a `literal` / `arrayOfLiteral` decodes against its closed `OptionList`;
 *   - a `checkboxBoolean` is the `true` / `false` / `on` three-token codec
 *     (`registration-schema.ts:50-59`), `optional: true` making an unchecked
 *     (absent) box valid;
 *   - a discriminated `variant` set models its variant-specific fields as
 *     struct-level optionals and requires them — at their own field paths — via a
 *     struct-level filter keyed on the discriminator (the attendee/exhibitor
 *     split of `registration-schema.ts:239-302`);
 *   - a `requiredWhenEquals` cross-field rule requires its `target` (at the
 *     target's path) when its `when` field equals one of `equals` (the
 *     `method`-gated email/phone requirement of `contact.tsx:91-109`).
 *
 * `make-impossible-states-unrepresentable`: the `FormDefinition` boundary already
 * proved every `MessageKey` is a real `TranslationKey` and every `FieldName` is a
 * safe identifier, so this module interpolates names into paths and hands keys to
 * the issue tree with no further guarding (`boundary-discipline` — the validation
 * lives at the schema boundary, not here).
 */

/** A decoded form payload — a flat/nested record of field names to decoded values. */
export type DecodedForm = Record<string, unknown>;

/**
 * The string-or-absent value the browser submits for one field, before any
 * boolean/literal decoding. A duplicate field name POSTs an array, which the
 * hand-tuned schemas treat as an invalid type — so the input schema accepts
 * `unknown` and each leaf's node-level message labels the invalid-type path.
 */
type Encoded = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Leaf codecs — one per FieldKind, mirroring the hand-tuned annotation idiom
// ---------------------------------------------------------------------------

/** Required free-text: empty, absent, and non-string all emit `message`. */
const requiredString = (message: MessageKey) =>
  Schema.String.annotate({ message })
    .check(Schema.isMinLength(1, { message }))
    .annotateKey({ messageMissingKey: message });

/**
 * Present-but-empty-allowed free-text (the "other notes" field): a present
 * non-string emits `message`; an empty string and an absent value are valid
 * (the field is `optionalKey`, so absence never reports). Mirrors
 * `registration-schema.ts` `OptionalText` + the contact/volunteer optional text.
 */
const optionalText = (message: MessageKey) =>
  Schema.optionalKey(Schema.String.annotate({ message }));

/** Required email: empty/absent emit `requiredMessage`, malformed emits `invalidMessage`. */
const email = (requiredMessage: MessageKey, invalidMessage: MessageKey) =>
  Schema.String.annotate({ message: invalidMessage })
    .check(
      Schema.isMinLength(1, { message: requiredMessage }),
      // The former zod `.email()`: a basic, permissive email shape.
      Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: invalidMessage }),
    )
    .annotateKey({ messageMissingKey: requiredMessage });

/** Required absolute URL: empty/absent emit `requiredMessage`, unparseable emits `invalidMessage`. */
const url = (requiredMessage: MessageKey, invalidMessage: MessageKey) =>
  Schema.String.annotate({ message: invalidMessage })
    .check(
      Schema.isMinLength(1, { message: requiredMessage }),
      Schema.makeFilter((value: string) => URL.canParse(value), {
        message: invalidMessage,
      }),
    )
    .annotateKey({ messageMissingKey: requiredMessage });

/** Required single choice from a closed option set: off-list/absent emit `message`. */
const literal = (
  options: ReadonlyArray<{ readonly value: string }>,
  message: MessageKey,
) =>
  Schema.Literals(options.map((option) => option.value))
    .annotate({ message })
    .annotateKey({ messageMissingKey: message });

/**
 * The `true` / `false` / `on` checkbox-boolean codec (`registration-schema.ts`
 * `StringToBoolean`): `"true"` / `"on"` → `true`, `"false"` → `false`, any other
 * token (or an array from a duplicate name) emits `message`.
 */
const stringToBoolean = (message: MessageKey) =>
  Schema.Literals(['true', 'false', 'on'])
    .annotate({ message })
    .pipe(
      Schema.decodeTo(Schema.Boolean, {
        decode: SchemaGetter.transform((value) => value !== 'false'),
        encode: SchemaGetter.transform((value) => (value ? 'true' : 'false')),
      }),
    )
    .annotate({ message });

/** Required multi-select over a closed option set: an off-list element emits `message`. */
const arrayOfLiteral = (
  options: ReadonlyArray<{ readonly value: string }>,
  message: MessageKey,
) =>
  Schema.mutable(
    Schema.Array(
      Schema.Literals(options.map((option) => option.value)).annotate({
        message,
      }),
    ),
  ).annotateKey({ messageMissingKey: message });

/**
 * The required schema for one field kind, modelling the WHERE-it-appears-it-is-
 * required contract: a leaf is always required at its own field key. Whole-field
 * optionality (an off-variant field) is the variant's concern and is applied by
 * {@link fieldToOptionalSchema}, never a per-kind flag (mirrors the
 * `FieldKind` doc's "no per-field required:false knob").
 */
const fieldToRequiredSchema = (
  field: FieldKind,
): Schema.Top => {
  switch (field._tag) {
    case 'requiredText':
      return requiredString(field.requiredMessage);
    case 'optionalText':
      // The leaf itself is `optionalKey`; see `buildStructFields`. The "required"
      // schema for a present value is just the labelled string.
      return Schema.String.annotate({ message: field.invalidMessage });
    case 'email':
      return email(field.requiredMessage, field.invalidMessage);
    case 'url':
      return url(field.requiredMessage, field.invalidMessage);
    case 'literal':
      return literal(field.options, field.requiredMessage);
    case 'checkboxBoolean':
      return stringToBoolean(field.requiredMessage).annotateKey({
        messageMissingKey: field.requiredMessage,
      });
    case 'arrayOfLiteral':
      return arrayOfLiteral(field.options, field.requiredMessage);
    case 'nestedGroup':
      return Schema.Struct(buildStructFields(field.fields));
  }
};

/**
 * The struct-field entry for one field — `{ name: schema }` — accounting for
 * inherent optionality (`optionalText` and an `optional: true` checkbox are
 * `optionalKey`; everything else is required at its key). Variant-conditional
 * optionality is layered separately by {@link buildVariantOptionalFields}.
 */
const fieldToStructEntry = (
  field: FieldKind,
): readonly [string, Schema.Top] => {
  if (field._tag === 'optionalText') {
    return [field.name, optionalText(field.invalidMessage)];
  }
  if (field._tag === 'checkboxBoolean' && field.optional === true) {
    return [field.name, Schema.optionalKey(stringToBoolean(field.requiredMessage))];
  }
  return [field.name, fieldToRequiredSchema(field)];
};

/** Build the `Schema.Struct` field map for a list of fields. */
const buildStructFields = (
  fields: ReadonlyArray<FieldKind>,
): Record<string, Schema.Top> => {
  const entries: Record<string, Schema.Top> = {};
  for (const field of fields) {
    const [name, schema] = fieldToStructEntry(field);
    entries[name] = schema;
  }
  return entries;
};

// ---------------------------------------------------------------------------
// Variants — optional struct fields + a discriminator-keyed presence filter
// ---------------------------------------------------------------------------

/**
 * A variant's fields are modelled as struct-level optionals so the off-variant
 * never demands them; the presence requirement is re-imposed (at each field's own
 * path) by {@link makeVariantFilter}. A present variant field still runs its own
 * format/literal checks. Mirrors `registration-schema.ts:216-238`.
 */
const buildVariantOptionalFields = (
  variant: FormVariantSet,
): Record<string, Schema.Top> => {
  const entries: Record<string, Schema.Top> = {};
  // The discriminator itself is always required (its absent/off-list value
  // attributes to the discriminator field), like `Registrant.type`.
  entries[variant.discriminator] = Schema.Literals(
    variant.options.map((option) => option.value),
  )
    .annotate({ message: variant.requiredMessage })
    .annotateKey({ messageMissingKey: variant.requiredMessage });
  for (const branch of variant.variants) {
    for (const field of branch.fields) {
      const [name, schema] = fieldToStructEntry(field);
      // Already optional (optionalText / optional checkbox) → keep as-is; an
      // inherently-required leaf is wrapped so the off-variant doesn't demand it.
      entries[name] = Schema.optional(schema as Schema.Codec<unknown, unknown>);
    }
  }
  return entries;
};

/**
 * The struct-level filter that requires each variant's fields — at their own
 * paths — when the discriminator selects that variant. Emits the field's own
 * required `MessageKey` so an absent variant-required field renders the same copy
 * it would as a non-variant required field.
 */
const makeVariantFilter = (variant: FormVariantSet) =>
  Schema.makeFilter(
    (value: Record<string, unknown>) => {
      const selected = value[variant.discriminator];
      const issues: Array<{
        path: ReadonlyArray<PropertyKey>;
        issue: string;
      }> = [];
      const branch = variant.variants.find((v) => v.value === selected);
      if (branch) {
        for (const field of branch.fields) {
          // optionalText / optional checkbox are legitimately absent; their
          // presence is never required by the variant. A `nestedGroup`'s own
          // absence surfaces at the group key through its inner required fields
          // (the registration nested groups are common, not variant, fields), so
          // the variant filter never imposes group-level presence.
          if (
            field._tag === 'optionalText' ||
            field._tag === 'nestedGroup' ||
            (field._tag === 'checkboxBoolean' && field.optional === true)
          ) {
            continue;
          }
          if (value[field.name] === undefined) {
            issues.push({
              path: [field.name],
              issue: requiredMessageOf(field),
            });
          }
        }
      }
      return issues.length === 0 ? undefined : issues;
    },
    { title: 'FormVariantSet.presence' },
  );

/**
 * The `MessageKey` a presence-requirable field emits when absent. `optionalText`
 * and `nestedGroup` are never presence-required by a variant (the caller skips
 * them), so they are excluded from the input type — there is no required key to
 * return for them.
 */
const requiredMessageOf = (
  field: Extract<
    FieldKind,
    { requiredMessage: MessageKey }
  >,
): string => field.requiredMessage;

// ---------------------------------------------------------------------------
// Cross-field rules
// ---------------------------------------------------------------------------

/**
 * The struct-level filter for one `requiredWhenEquals` rule: when the `when`
 * field's value is one of `equals`, the `target` field is required, and a missing
 * target emits `message` at the target's path. Mirrors the `method`-gated
 * email/phone requirement of `contact.tsx:91-109`.
 */
const makeRuleFilter = (rule: CrossFieldRule) =>
  Schema.makeFilter(
    (value: Record<string, unknown>) => {
      const trigger = value[rule.when];
      const triggered =
        typeof trigger === 'string' && rule.equals.includes(trigger as never);
      if (triggered && value[rule.target] === undefined) {
        return [{ path: [rule.target], issue: rule.message }];
      }
      return undefined;
    },
    { title: `CrossFieldRule.${rule.when}` },
  );

// ---------------------------------------------------------------------------
// definitionToSchema — compile a FormDefinition into a validating codec
// ---------------------------------------------------------------------------

/**
 * Compile a `FormDefinition` into the Effect Schema codec that validates its
 * submissions. The common `fields`, the optional variant fields, the variant
 * presence filter, and every cross-field rule filter are composed into one
 * `Schema.Struct` whose `Issue` tree feeds `formatSchemaResult` unchanged. The
 * struct-level filters run in declaration order (variant presence first, then
 * rules), each attaching its issues to its own field paths.
 */
export const definitionToSchema = (
  definition: FormDefinition,
): Schema.Codec<DecodedForm, Encoded> => {
  const fields: Record<string, Schema.Top> = buildStructFields(
    definition.fields,
  );
  if (definition.variant) {
    Object.assign(fields, buildVariantOptionalFields(definition.variant));
  }

  let struct = Schema.Struct(fields);
  const filters = [
    ...(definition.variant ? [makeVariantFilter(definition.variant)] : []),
    ...(definition.rules ?? []).map(makeRuleFilter),
  ];
  for (const filter of filters) {
    struct = struct.check(filter as never) as typeof struct;
  }
  return struct as unknown as Schema.Codec<DecodedForm, Encoded>;
};

/**
 * Decode an unknown submission payload against a `FormDefinition`. Returns a
 * `Result` whose failure channel is the Effect Schema `Issue` tree — paired with
 * `formatSchemaResult` in the generic action skeleton (Branch 6.2) to bucket
 * failures into conform's `{ formErrors, fieldErrors }`. Reuses `parseSchema`'s
 * contract (`decodeUnknownResult`) so the generated codec and the hand-written
 * siblings share one decode boundary.
 */
export const decodeForm = (
  definition: FormDefinition,
  payload: unknown,
): Result.Result<DecodedForm, Issue> =>
  Schema.decodeUnknownResult(definitionToSchema(definition))(payload);

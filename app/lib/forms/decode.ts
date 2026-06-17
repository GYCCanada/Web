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
  // An `optional: true` text/email/url is optional-at-KEY (absence valid) but
  // keeps its full non-empty + format codec for a PRESENT value — the empty
  // present value still emits `requiredMessage`. This is the cross-field-gated
  // `email`/`phone` of contact/volunteer (`Schema.optional(Email)` in the
  // oracle, where `Email` itself enforces `isMinLength(1)`): the rule governs
  // presence, the field forbids a blank present value. `Schema.optional` (not
  // `optionalKey`) so an explicit `undefined` is also accepted, matching the
  // oracle wrapper. The wrapper is annotated with the field's INVALID-TYPE
  // message (`invalidMessage` for email/url, `requiredMessage` for text) so a
  // duplicate-name ARRAY value maps to a real key instead of the `optional`
  // wrapper's default union-mismatch text — exactly the oracle's
  // `Schema.optional(Email).annotate({ message })`
  // (`contact.tsx`'s `email`/`phone` wrappers).
  if (
    (field._tag === 'requiredText' ||
      field._tag === 'email' ||
      field._tag === 'url') &&
    field.optional === true
  ) {
    const invalidTypeMessage =
      field._tag === 'requiredText' ? field.requiredMessage : field.invalidMessage;
    return [
      field.name,
      Schema.optional(
        fieldToRequiredSchema(field) as Schema.Codec<unknown, unknown>,
      ).annotate({ message: invalidTypeMessage }),
    ];
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

/** One presence issue a struct-level predicate reports, at a field path. */
type PresenceIssue = {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly issue: string;
};

/**
 * The required `MessageKey` a presence-requirable LEAF emits when absent. A
 * `nestedGroup` (handled by {@link groupPresenceIssue}) and an `optionalText`
 * (never presence-required) are excluded from the input type — they have no
 * single required key to return.
 */
const requiredMessageOf = (
  field: Extract<FieldKind, { requiredMessage: MessageKey }>,
): string => field.requiredMessage;

/**
 * The presence issue an ABSENT selected-variant `nestedGroup` surfaces: a real
 * key at the group's FIRST presence-requirable inner field path (e.g.
 * `['extra', <first required inner field>]`), mirroring the registration
 * oracle's `['extra', 'tos']` (`registration-schema.ts:274-279`) — a selected
 * attendee branch that omits the whole `extra` group is an error, not a success
 * (`make-impossible-states-unrepresentable`). An empty group (no presence-
 * requirable inner field) cannot anchor a key, so it imposes no group-level
 * presence — its own (absent) inner fields carry no requirement anyway.
 */
const groupPresenceIssue = (
  group: Extract<FieldKind, { _tag: 'nestedGroup' }>,
): PresenceIssue | undefined => {
  for (const inner of group.fields) {
    if (!isPresenceRequirableLeaf(inner)) continue;
    return { path: [group.name, inner.name], issue: requiredMessageOf(inner) };
  }
  return undefined;
};

/**
 * A leaf whose PRESENCE a variant/group can require when its branch is selected:
 * everything except `optionalText` (empty-allowed), an `optional: true` leaf
 * (checkbox / scalar — legitimately absent), and a `nestedGroup` (its own
 * presence is anchored by {@link groupPresenceIssue}, not a single key). The
 * survivors all carry a `requiredMessage`, so the narrowed type is the input to
 * {@link requiredMessageOf}.
 */
const isPresenceRequirableLeaf = (
  field: FieldKind,
): field is Extract<FieldKind, { requiredMessage: MessageKey }> => {
  if (field._tag === 'optionalText' || field._tag === 'nestedGroup') {
    return false;
  }
  if ('optional' in field && field.optional === true) return false;
  return true;
};

/**
 * The presence requirements a discriminated `variant` imposes on the SELECTED
 * branch's fields — at their own paths — collected (not aborted) so a payload
 * missing several branch fields surfaces them all at once, exactly as the
 * oracle's single accumulating struct filter does
 * (`registration-schema.ts:239-302`). A selected branch's leaf that is absent
 * emits the leaf's required key at `[name]`; a selected branch's absent
 * `nestedGroup` emits a real key at its first inner required field
 * ({@link groupPresenceIssue}). An off-variant field is never demanded.
 */
const variantPresenceIssues = (
  variant: FormVariantSet,
  value: Record<string, unknown>,
): ReadonlyArray<PresenceIssue> => {
  const selected = value[variant.discriminator];
  const branch = variant.variants.find((v) => v.value === selected);
  if (!branch) return [];
  const issues: Array<PresenceIssue> = [];
  for (const field of branch.fields) {
    if (field._tag === 'nestedGroup') {
      if (value[field.name] === undefined) {
        const issue = groupPresenceIssue(field);
        if (issue) issues.push(issue);
      }
      continue;
    }
    if (!isPresenceRequirableLeaf(field)) continue;
    if (value[field.name] === undefined) {
      issues.push({ path: [field.name], issue: requiredMessageOf(field) });
    }
  }
  return issues;
};

// ---------------------------------------------------------------------------
// Cross-field rules
// ---------------------------------------------------------------------------

/**
 * The presence requirement one `requiredWhenEquals` rule imposes: when the
 * `when` field's value is one of `equals`, the `target` field is required, and
 * an absent-OR-empty target emits `message` at the target's path. Mirrors the
 * `method`-gated email/phone requirement of `contact.tsx:91-109`.
 *
 * The "required" sense here is PRESENCE-and-non-emptiness, not mere
 * key-presence. The oracle gates `email` as `Schema.optional(Email)` where
 * `Email` enforces `isMinLength(1)`, so `{ method: 'email', email: '' }` is a
 * decode error, not a success: a visibly-blank required field must never be
 * representable as valid (`make-impossible-states-unrepresentable`). The
 * recommended modelling pairs this rule with an `optional: true` `email`/text
 * target (optional-at-key, non-empty-when-present), where the FIELD codec
 * already rejects a present `''` (and does so BEFORE this struct-level filter
 * runs, so no duplicate issue is reported); this predicate additionally rejects
 * the absent/empty target so the requirement holds even if a definition gates
 * an empty-permitting `optionalText` target.
 */
const rulePresenceIssue = (
  rule: CrossFieldRule,
  value: Record<string, unknown>,
): PresenceIssue | undefined => {
  const trigger = value[rule.when];
  const triggered =
    typeof trigger === 'string' && rule.equals.includes(trigger as never);
  const target = value[rule.target];
  const unsatisfied = target === undefined || target === '';
  return triggered && unsatisfied
    ? { path: [rule.target], issue: rule.message }
    : undefined;
};

/**
 * The SINGLE struct-level presence filter for a definition: the variant's
 * selected-branch requirements plus every cross-field rule, accumulated into one
 * issue list. Composing one accumulating filter (rather than chaining a
 * `.check` per concern) matches the oracle's single struct-level
 * `Schema.makeFilter` and is REQUIRED for fidelity — chained `.check`s ABORT
 * after the first failing filter (Effect's default), so two unsatisfied rules
 * (the contact/volunteer `email`+`phone` pair) would surface only one. One
 * filter collecting all issues reproduces the oracle's "report multiple failures
 * at once" behaviour without depending on a non-default `errors: 'all'` decode.
 */
const makePresenceFilter = (definition: FormDefinition) =>
  Schema.makeFilter(
    (value: Record<string, unknown>) => {
      const issues: Array<PresenceIssue> = [];
      if (definition.variant) {
        issues.push(...variantPresenceIssues(definition.variant, value));
      }
      for (const rule of definition.rules ?? []) {
        const issue = rulePresenceIssue(rule, value);
        if (issue) issues.push(issue);
      }
      return issues.length === 0 ? undefined : issues;
    },
    { title: 'FormDefinition.presence' },
  );

// ---------------------------------------------------------------------------
// definitionToSchema — compile a FormDefinition into a validating codec
// ---------------------------------------------------------------------------

/**
 * Compile a `FormDefinition` into the Effect Schema codec that validates its
 * submissions. The common `fields` and the optional variant fields form one
 * `Schema.Struct`; a SINGLE struct-level presence filter
 * ({@link makePresenceFilter}) re-imposes the variant's selected-branch
 * requirements and every cross-field rule, accumulating all issues at their own
 * field paths. The struct's `Issue` tree feeds `formatSchemaResult` unchanged.
 * One accumulating filter (not a chain of `.check`s) is required so multiple
 * unsatisfied requirements all surface, matching the oracle's single struct
 * filter.
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

  const struct = Schema.Struct(fields).check(
    makePresenceFilter(definition) as never,
  );
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

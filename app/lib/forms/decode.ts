import { Result, Schema, SchemaGetter } from 'effect';
import type { Issue } from 'effect/SchemaIssue';

import { activationIndex, isActiveByName } from './activation';
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

/**
 * Required free-text: empty, absent, and non-string all emit `message`.
 *
 * EXPORTED (registrar plan C7): the route-owned party shell
 * (`registration-shell.ts`) is a new caller — it builds the `group`-arm payer's
 * `name` codec from the authored `requiredMessage` with the same idiom the engine
 * uses for a `requiredText` leaf, rather than re-declaring a parallel non-empty
 * string codec (`derive-dont-sync`).
 */
export const requiredString = (message: MessageKey) =>
  Schema.String.annotate({ message })
    .check(Schema.isMinLength(1, { message }))
    .annotateKey({ messageMissingKey: message });

/**
 * Genuinely-optional free-text: an empty string, an ABSENT key, and an explicit
 * `undefined` are all valid; a present non-string emits `message`. Realizes the
 * former hand-tuned `OptionalString` (`Schema.optional(Schema.String…)`, the
 * registration oracle retired in Branch 6.6) — registration's `church` /
 * `instrument` / `dietaryRestrictions`.
 *
 * `Schema.optional` (not `optionalKey`) so an explicit `undefined` is accepted too,
 * matching that `OptionalString` exactly on the values the form actually submits
 * (absent / valid string). The wrapper is `.annotate({ message })` so a present
 * non-string (a duplicate-name ARRAY — an out-of-form payload) maps to the field's
 * real `MessageKey` instead of `Schema.optional`'s default
 * `"Expected string | undefined, got …"` union-mismatch text (which would render
 * BLANK in `FieldErrors`). The former oracle left this edge un-annotated; relabeling
 * it is strictly safer and was never observed in the equivalence corpus (the form
 * submits absent or a string for a single text field). The same wrapper-annotation
 * idiom as the `optional: true` text/email/url path below. This is the
 * `requirePresent` absent/false branch.
 */
const optionalText = (message: MessageKey) =>
  Schema.optional(Schema.String.annotate({ message })).annotate({ message });

/**
 * Key-must-be-present, empty-string-allowed free-text: a present non-string emits
 * `message`; an empty string is valid; an ABSENT key emits `message` (via
 * `messageMissingKey`). Realizes the former hand-tuned `OptionalText`
 * (`Schema.String…annotateKey({ messageMissingKey })`, NOT optional; the
 * registration oracle retired in Branch 6.6) — registration's `extra.other`. The
 * two former behaviours must NOT collapse onto one engine kind (the always-rendered
 * `extra` block POSTs an empty `other`, so an absent `other` inside a present
 * `extra` is the out-of-form payload that schema rejects). Selected by the
 * `optionalText` kind's `requirePresent: true` flag.
 */
const presentEmptyAllowedText = (message: MessageKey) =>
  Schema.String.annotate({ message }).annotateKey({ messageMissingKey: message });

/**
 * Required email: empty/absent emit `requiredMessage`, malformed emits `invalidMessage`.
 *
 * EXPORTED (registrar plan C7): the route-owned party shell
 * (`registration-shell.ts`) decodes the `group`-arm payer's required `email`
 * through this very codec, so the nominated payer's address is validated by the
 * SAME permissive-email shape every form `email` field uses (`derive-dont-sync`).
 */
export const email = (requiredMessage: MessageKey, invalidMessage: MessageKey) =>
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

/**
 * The non-negative-integer count codec (C9): the browser submits the count as a
 * STRING, so this parses it to a real integer and runs the field's inclusive
 * `min`/`max` bounds. An empty / absent value emits `requiredMessage` (a count was
 * required but not entered); a non-numeric, non-integer, or out-of-range value
 * emits `invalidMessage`. The decoded value is a real `number`, exactly what
 * `price.ts`'s `quantity` rule multiplies — no raw-string handling downstream
 * (`boundary-discipline`). Mirrors `stringToBoolean`'s string→typed transform.
 */
const numberFromString = (
  requiredMessage: MessageKey,
  invalidMessage: MessageKey,
  min: number | undefined,
  max: number | undefined,
) => {
  const bounds = [
    Schema.isInt({ message: invalidMessage }),
    Schema.isGreaterThanOrEqualTo(min ?? 0, { message: invalidMessage }),
    ...(max !== undefined
      ? [Schema.isLessThanOrEqualTo(max, { message: invalidMessage })]
      : []),
  ] as const;
  return Schema.String.annotate({ message: invalidMessage })
    .check(Schema.isMinLength(1, { message: requiredMessage }))
    .pipe(
      Schema.decodeTo(Schema.Number.check(...bounds), {
        decode: SchemaGetter.transform((value) => Number(value)),
        encode: SchemaGetter.transform((value) => String(value)),
      }),
    )
    .annotateKey({ messageMissingKey: requiredMessage });
};

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
  activationTargets: ReadonlySet<string>,
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
    case 'number':
      return numberFromString(
        field.requiredMessage,
        field.invalidMessage,
        field.min,
        field.max,
      );
    case 'nestedGroup':
      return Schema.Struct(buildStructFields(field.fields, activationTargets));
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
  activationTargets: ReadonlySet<string>,
): readonly [string, Schema.Top] => {
  if (field._tag === 'optionalText') {
    return [
      field.name,
      field.requirePresent === true
        ? presentEmptyAllowedText(field.invalidMessage)
        : optionalText(field.invalidMessage),
    ];
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
      field._tag === 'url' ||
      field._tag === 'number') &&
    field.optional === true
  ) {
    const invalidTypeMessage =
      field._tag === 'requiredText' ? field.requiredMessage : field.invalidMessage;
    return [
      field.name,
      Schema.optional(
        fieldToRequiredSchema(field, activationTargets) as Schema.Codec<
          unknown,
          unknown
        >,
      ).annotate({ message: invalidTypeMessage }),
    ];
  }
  return [field.name, fieldToRequiredSchema(field, activationTargets)];
};

/**
 * An `activeWhenEquals` target is optional-AT-KEY at the struct level so an
 * INACTIVE (legitimately absent) value decodes; the activation guard in
 * {@link makePresenceFilter} then re-imposes presence WHEN active and rejects a
 * PRESENT-but-inactive value as an out-of-form payload (registrar plan Decision
 * 5's four decode rows). A target that is ALREADY optional-at-key (an
 * `optionalText`, an `optional: true` leaf) is unchanged — wrapping is only the
 * absent-decodes guarantee, which it already has. `Schema.optional` (not
 * `optionalKey`) mirrors the variant/cross-field-gated wrapping idiom (accepts an
 * explicit `undefined` too); a present value still runs the kind's full codec.
 */
const asActivatable = (
  schema: Schema.Top,
  name: string,
  activationTargets: ReadonlySet<string>,
): Schema.Top =>
  activationTargets.has(name)
    ? Schema.optional(schema as Schema.Codec<unknown, unknown>)
    : schema;

/** Build the `Schema.Struct` field map for a list of fields. */
const buildStructFields = (
  fields: ReadonlyArray<FieldKind>,
  activationTargets: ReadonlySet<string>,
): Record<string, Schema.Top> => {
  const entries: Record<string, Schema.Top> = {};
  for (const field of fields) {
    const [name, schema] = fieldToStructEntry(field, activationTargets);
    entries[name] = asActivatable(schema, name, activationTargets);
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
  activationTargets: ReadonlySet<string>,
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
      const [name, schema] = fieldToStructEntry(field, activationTargets);
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
 * key inside the group, anchored at the field the definition's `presenceAnchor`
 * names (registration's `extra` → `tos`, matching the registration oracle's
 * `['extra', 'tos']` anchor, `registration-schema.ts:274-279`), or — when no
 * anchor is declared — the group's FIRST presence-requirable inner field (the
 * back-compatible default). A selected attendee branch that omits the whole
 * `extra` group is an error, not a success
 * (`make-impossible-states-unrepresentable`); WHICH inner key carries it is
 * DECLARED data, not a positional coincidence (`derive-dont-sync`) — this is what
 * makes the engine's emitted `TranslationKey` set identical to the oracle's
 * (ADR 0007, plan §"identical emitted TranslationKey sets").
 *
 * A declared `presenceAnchor` that does not name a presence-requirable inner field
 * is ignored (fall through to first) rather than silently dropped — the
 * `FieldName` brand guarantees it is a safe token, but it could name a non-
 * presence-requirable inner field (an `optionalText`); the first presence-
 * requirable field is then the only meaningful anchor. An empty group (no
 * presence-requirable inner field) cannot anchor a key, so it imposes no group-
 * level presence — its own (absent) inner fields carry no requirement anyway.
 */
const groupPresenceIssue = (
  group: Extract<FieldKind, { _tag: 'nestedGroup' }>,
): PresenceIssue | undefined => {
  if (group.presenceAnchor !== undefined) {
    const anchored = group.fields.find(
      (inner) =>
        inner.name === group.presenceAnchor && isPresenceRequirableLeaf(inner),
    );
    if (anchored && isPresenceRequirableLeaf(anchored)) {
      return {
        path: [group.name, anchored.name],
        issue: requiredMessageOf(anchored),
      };
    }
  }
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
      // An `optional: true` group (registration's minors-only `parent`, the
      // opt-in `volunteer`) is legitimately absent — the variant never demands
      // it; a PRESENT one still runs its inner checks (the struct codec). A
      // non-optional group (the always-rendered `extra`) absent inside the
      // selected variant is an error anchored at its first inner required field.
      if (field.optional !== true && value[field.name] === undefined) {
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
  rule: Extract<CrossFieldRule, { _tag: 'requiredWhenEquals' }>,
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
 * The two `MessageKey`s an `activeWhenEquals` target carries for its activation
 * rows (registrar plan Decision 5), keyed by the field name:
 *   - `requiredMessage` — the active-but-absent key (the target is now required).
 *     PRESENT only for a presence-requirable leaf; `undefined` for an
 *     intrinsically-optional target (an `optionalText`, an `optional: true`
 *     leaf), which has no presence requirement when active (absence is valid).
 *   - `rejectMessage` — the present-but-inactive (out-of-form payload) key,
 *     emitted UNCONDITIONALLY for ANY indexed target regardless of optionality
 *     (registrar-plan.md:548 — row 2 is an unconditional reject). The kind's own
 *     `invalidMessage` when it carries one (the smuggled value is malformed by
 *     definition — it should not be in the payload at all), else its
 *     `requiredMessage`. This mirrors `extra.other`'s out-of-form reject and
 *     enforces the decode-boundary "a smuggled value NEVER reaches price()"
 *     defense for the blessed `active ∧ optional ∧ priced` shape
 *     (registrar-plan.md:481-482).
 * A `nestedGroup` carries neither single key (its presence is anchored, not a
 * single leaf) and is absent from the index.
 */
type ActivationTargetKeys = {
  readonly requiredMessage?: MessageKey;
  readonly rejectMessage: MessageKey;
};

/**
 * The out-of-form (present-but-inactive) reject `MessageKey` of any activatable
 * leaf: its `invalidMessage` when the kind carries one, else its
 * `requiredMessage`. A `nestedGroup` (no single leaf key) is excluded.
 */
const activationRejectMessageOf = (
  field: Exclude<FieldKind, { _tag: 'nestedGroup' }>,
): MessageKey =>
  ('invalidMessage' in field
    ? field.invalidMessage
    : field.requiredMessage) as MessageKey;

const activationTargetKeys = (
  definition: FormDefinition,
): ReadonlyMap<string, ActivationTargetKeys> => {
  const keys = new Map<string, ActivationTargetKeys>();
  const collect = (fields: ReadonlyArray<FieldKind>): void => {
    for (const field of fields) {
      if (field._tag === 'nestedGroup') continue;
      keys.set(field.name, {
        requiredMessage: isPresenceRequirableLeaf(field)
          ? (field.requiredMessage as MessageKey)
          : undefined,
        rejectMessage: activationRejectMessageOf(field),
      });
    }
  };
  collect(definition.fields);
  for (const branch of definition.variant?.variants ?? []) {
    collect(branch.fields);
  }
  return keys;
};

/**
 * The activation issues an `activeWhenEquals` rule imposes on the decoded value
 * (registrar plan Decision 5's four decode rows). `target` is modelled
 * optional-at-key ({@link asActivatable}) so an INACTIVE-absent value decodes;
 * this filter re-imposes the rest:
 *   - active + absent  ⇒ REJECT (now required) — emit the target's
 *     `requiredMessage`, BUT only when the target carries one: an
 *     intrinsically-optional active target (an `optionalText`, an `optional: true`
 *     leaf) has no presence requirement, so its absence is valid;
 *   - present + inactive ⇒ REJECT (out-of-form payload) — emit the target's
 *     `rejectMessage` UNCONDITIONALLY for ANY indexed target, regardless of
 *     optionality (registrar-plan.md:548), so a smuggled value on an optional
 *     priced activation target (the blessed `active ∧ optional ∧ priced` shape,
 *     registrar-plan.md:481-482) is rejected at the decode boundary and NEVER
 *     reaches price() — mirroring `extra.other`'s out-of-form reject;
 *   - active + present / inactive + absent ⇒ valid (the struct codec already ran
 *     the kind codec for a present value).
 * The two rows are independent: the active-absent row is GATED on a presence
 * requirement (skip when `requiredMessage` is undefined), the present-inactive
 * row is not.
 */
const activationPresenceIssues = (
  definition: FormDefinition,
  index: ReadonlyMap<string, Extract<CrossFieldRule, { _tag: 'activeWhenEquals' }>>,
  targetKeys: ReadonlyMap<string, ActivationTargetKeys>,
  value: Record<string, unknown>,
): ReadonlyArray<PresenceIssue> => {
  const issues: Array<PresenceIssue> = [];
  for (const [target] of index) {
    const keys = targetKeys.get(target);
    if (keys === undefined) continue;
    const active = isActiveByName(target, index, value);
    const present = value[target] !== undefined;
    if (active && !present) {
      // Active-but-absent is only a violation when the target is itself
      // presence-requirable; an intrinsically-optional active target may be absent.
      if (keys.requiredMessage !== undefined) {
        issues.push({ path: [target], issue: keys.requiredMessage });
      }
    } else if (!active && present) {
      // Present-but-inactive is ALWAYS an out-of-form payload — reject regardless
      // of whether the target carries a presence requirement.
      issues.push({ path: [target], issue: keys.rejectMessage });
    }
  }
  return issues;
};

/**
 * The SINGLE struct-level presence filter for a definition: the variant's
 * selected-branch requirements, every cross-field rule, AND the activation rows
 * (registrar plan Decision 5), accumulated into one issue list. Composing one
 * accumulating filter (rather than chaining a `.check` per concern) matches the
 * oracle's single struct-level `Schema.makeFilter` and is REQUIRED for fidelity —
 * chained `.check`s ABORT after the first failing filter (Effect's default), so
 * two unsatisfied rules (the contact/volunteer `email`+`phone` pair) would
 * surface only one. One filter collecting all issues reproduces the oracle's
 * "report multiple failures at once" behaviour without depending on a non-default
 * `errors: 'all'` decode.
 *
 * An `activeWhenEquals` target's presence is GATED by activation, so its row is
 * skipped from the plain variant/rule presence checks (it is optional-at-key) and
 * handled by {@link activationPresenceIssues} instead — the one place the four
 * decode rows live (`derive-dont-sync`: the same `isActiveByName` price/render
 * read).
 */
const makePresenceFilter = (definition: FormDefinition) => {
  const index = activationIndex(definition);
  const targetKeys = activationTargetKeys(definition);
  return Schema.makeFilter(
    (value: Record<string, unknown>) => {
      const issues: Array<PresenceIssue> = [];
      if (definition.variant) {
        for (const issue of variantPresenceIssues(definition.variant, value)) {
          // An activation target's presence is the activation filter's job — the
          // variant must not ALSO demand a (possibly-inactive) field.
          if (!index.has(String(issue.path[0]))) issues.push(issue);
        }
      }
      for (const rule of definition.rules ?? []) {
        if (rule._tag !== 'requiredWhenEquals') continue;
        const issue = rulePresenceIssue(rule, value);
        if (issue) issues.push(issue);
      }
      issues.push(
        ...activationPresenceIssues(definition, index, targetKeys, value),
      );
      return issues.length === 0 ? undefined : issues;
    },
    { title: 'FormDefinition.presence' },
  );
};

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
  // An `activeWhenEquals` target is optional-at-key so an inactive value decodes;
  // the presence filter re-imposes activation's four decode rows.
  const activationTargets = new Set(activationIndex(definition).keys());
  const fields: Record<string, Schema.Top> = buildStructFields(
    definition.fields,
    activationTargets,
  );
  if (definition.variant) {
    Object.assign(
      fields,
      buildVariantOptionalFields(definition.variant, activationTargets),
    );
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

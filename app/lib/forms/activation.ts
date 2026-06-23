import type { ActiveWhen, CrossFieldRule, FormDefinition } from './definition';

/**
 * The ONE shared, pure activation evaluator (registrar plan Decision 5). A
 * field's ACTIVATION is the first of the three orthogonal axes the registrar
 * keys off a field — render-visibility, presence-requirement, and price-
 * eligibility all read this SAME predicate, never a re-implemented copy
 * (`derive-dont-sync`). A field with no `activeWhenEquals` rule targeting it is
 * always active; a field a rule DOES target is active only when the rule's
 * `ActiveWhen` predicate holds over its sibling's chosen value.
 *
 * Activation is purely VALUE-driven — it depends only on the chosen sibling
 * values, never on the clock or any effect — so this module is a plain
 * synchronous function (no `Effect`, no `Clock`). The three consumers (price,
 * decode, render) inject the decoded scope; this module owns the law.
 *
 * Scope is SAME-SCOPE-SIBLING-ONLY (v1): `predicate.when` names an earlier
 * sibling in the SAME flat decoded namespace as the target (the top-level fields
 * + the discriminator + every variant branch field all decode into one struct;
 * a `nestedGroup`'s inner fields form their own namespace). Enclosing-scope,
 * cross-branch, and chained/cyclic activation are deferred — the decode-time
 * integrity filter (`rulesReferToExistingFields`, `definition.ts`) rejects an
 * out-of-scope `when`/`target` or a cycle, so this evaluator only ever sees
 * a same-scope sibling lookup.
 */

/** The decoded sibling values a predicate reads — a flat name→value record. */
export type ActivationScope = Readonly<Record<string, unknown>>;

/** An `activeWhenEquals` rule, narrowed from the closed `CrossFieldRule` union. */
type ActivationRule = Extract<CrossFieldRule, { _tag: 'activeWhenEquals' }>;

/**
 * Whether an `ActiveWhen` predicate holds over the decoded scope. Each arm reads
 * the `when` sibling's DECODED value (the integrity filter has already proven
 * `when` names a field of the matching kind, so the runtime narrowing here only
 * guards against an absent/never-chosen value):
 *   - `literalEquals`     — a `literal` decodes to one `OptionValue` STRING;
 *   - `arrayIncludesAny`  — an `arrayOfLiteral` decodes to an array of strings;
 *   - `checkboxChecked`   — a `checkboxBoolean` decodes to a real `boolean`
 *     (`decode.ts`'s `true`/`false`/`on` codec), never the raw `'on'`/`'true'`.
 */
const predicateHolds = (
  predicate: ActiveWhen,
  scope: ActivationScope,
): boolean => {
  const value = scope[predicate.when];
  switch (predicate._tag) {
    case 'literalEquals':
      return (
        typeof value === 'string' && predicate.equals.includes(value as never)
      );
    case 'arrayIncludesAny':
      return (
        Array.isArray(value) &&
        value.some(
          (element) =>
            typeof element === 'string' &&
            predicate.values.includes(element as never),
        )
      );
    case 'checkboxChecked':
      return value === true;
  }
};

/**
 * Index a definition's `activeWhenEquals` rules by their `target` field name —
 * one rule per target (the integrity filter rejects a second rule sharing a
 * target via the cycle/dup checks). Built once per decode/price/render and
 * shared by {@link isActiveByName}.
 */
export const activationIndex = (
  definition: FormDefinition,
): ReadonlyMap<string, ActivationRule> => {
  const index = new Map<string, ActivationRule>();
  for (const rule of definition.rules ?? []) {
    if (rule._tag === 'activeWhenEquals') {
      index.set(rule.target, rule);
    }
  }
  return index;
};

/**
 * THE shared evaluator: is `fieldName` active given the decoded sibling `scope`?
 * No rule targets it ⇒ always active; otherwise the rule's predicate decides.
 * A same-scope sibling lookup (v1) — `scope` is the flat decoded namespace the
 * field lives in.
 */
export const isActiveByName = (
  fieldName: string,
  index: ReadonlyMap<string, ActivationRule>,
  scope: ActivationScope,
): boolean => {
  const rule = index.get(fieldName);
  return rule === undefined ? true : predicateHolds(rule.predicate, scope);
};

import { Schema } from 'effect';

import { FieldName, OptionValue } from './definition';

/**
 * The pricing dimension of the form engine — a SEPARATE structure keyed by
 * field/option, NOT inline on `FieldOption` (Decision 1). `FieldOption` is reused
 * by the variant discriminator, where a per-option price is meaningless; keying
 * pricing off a sibling structure keeps "price on a discriminator option" an
 * unrepresentable state (`make-impossible-states-unrepresentable`) and adds ONE
 * top-level field instead of widening every option-bearing kind.
 *
 * This module ships the money brands + the `PricingRule`/`PricingRules` schema.
 * Timing windows (C2), the `quantity` rule + `number` kind (C9), and the
 * registration deadline (C2) arrive in later commits; the schema here is the
 * pure-pricing core with zero Stripe and zero consumers.
 */

/**
 * Minor units (cents). `Int` rejects NaN/Inf/float; `>= 0` forbids negative
 * cents — a price is never below zero. Mirrors `BibleRef`'s `Schema.Int.check(...)`
 * brand idiom (`content/schema.ts:373`).
 */
export const Cents = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand('Cents'),
);
export type Cents = typeof Cents.Type;

/** A signed delta in cents — a discount window is negative, a surcharge positive. */
export const CentsDelta = Schema.Int.pipe(Schema.brand('CentsDelta'));
export type CentsDelta = typeof CentsDelta.Type;

/** ISO currency token; one currency per form (CAD for GYC). Closed literal — no silent mismatch. */
export const CurrencyCode = Schema.Literals(['cad']).pipe(Schema.brand('CurrencyCode'));
export type CurrencyCode = typeof CurrencyCode.Type;

/** A price delta keyed to a single selectable option of a priced field. */
const OptionPrice = Schema.Struct({ option: OptionValue, amount: Cents });

/**
 * A pricing rule keyed to one field. The tag matches the targeted `FieldKind`'s
 * decoded shape: `choice` (a `literal` — the selected option adds), `multiChoice`
 * (an `arrayOfLiteral` — each selected option adds), `toggle` (a `checkboxBoolean`
 * — `true` adds). The `quantity` rule (a `number` kind) lands in C9.
 */
export const PricingRule = Schema.TaggedUnion({
  choice: { field: FieldName, prices: Schema.Array(OptionPrice) }, // literal — selected option adds
  multiChoice: { field: FieldName, prices: Schema.Array(OptionPrice) }, // arrayOfLiteral — each adds
  toggle: { field: FieldName, amount: Cents }, // checkboxBoolean — true adds
});
export type PricingRule = typeof PricingRule.Type;

/**
 * The pricing dimension attached to a `FormDefinition` (wired in C2 via an
 * `optionalKey` sibling — absence ⇒ unpriced). One form-level `currency`, one
 * form-level `base` fee, and a flat list of field-keyed rules. Timing windows
 * and the registration deadline are added in C2.
 *
 * NOTE: billing-mode selection lives in the authored `party` section on
 * `FormDefinition` (Decision 2b — `party.billingMode.options`), NOT here.
 */
export const PricingRules = Schema.Struct({
  currency: CurrencyCode, // form-level, one currency
  base: Cents, // form-level base fee
  rules: Schema.Array(PricingRule),
});
export type PricingRules = typeof PricingRules.Type;

import { Schema } from 'effect';

import { IsoDate, ListItemId } from '../content/schema';
import { FieldName, OptionValue } from './tokens';

/**
 * The pricing dimension of the form engine — a SEPARATE structure keyed by
 * field/option, NOT inline on `FieldOption` (Decision 1). `FieldOption` is reused
 * by the variant discriminator, where a per-option price is meaningless; keying
 * pricing off a sibling structure keeps "price on a discriminator option" an
 * unrepresentable state (`make-impossible-states-unrepresentable`) and adds ONE
 * top-level field instead of widening every option-bearing kind.
 *
 * This module ships the money brands, the `PricingRule`/`PricingRules` schema,
 * and the `TimingWindow` early-bird/late modifiers (C2). The `quantity` rule (a
 * `number` kind, C9) clamps its entered count to `[0, max]` and multiplies by a
 * per-item `unit`; the schema here is the pure-pricing core with zero Stripe (the
 * pure evaluator that reads it lives in `price.ts`, C3).
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
 * A non-negative integer cap on a priced quantity (the same `Schema.Int.check(...)`
 * brand idiom as `Cents`): a quantity rule that clamps its priced count at `max`
 * (a per-form ticket cap) never multiplies an unbounded count by the unit price.
 */
const QuantityMax = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * A pricing rule keyed to one field. The tag matches the targeted `FieldKind`'s
 * decoded shape: `choice` (a `literal` — the selected option adds), `multiChoice`
 * (an `arrayOfLiteral` — each selected option adds), `toggle` (a `checkboxBoolean`
 * — `true` adds), `quantity` (a `number` — the entered count times `unit` adds,
 * the count clamped to `[0, max]` so a malicious/huge quantity cannot mint an
 * unbounded charge, C9). `unit` is the per-item price; `max` is an optional cap
 * (`optionalKey`, absence ⇒ uncapped above zero).
 */
export const PricingRule = Schema.TaggedUnion({
  choice: { field: FieldName, prices: Schema.Array(OptionPrice) }, // literal — selected option adds
  multiChoice: { field: FieldName, prices: Schema.Array(OptionPrice) }, // arrayOfLiteral — each adds
  toggle: { field: FieldName, amount: Cents }, // checkboxBoolean — true adds
  quantity: {
    field: FieldName,
    unit: Cents,
    max: Schema.optionalKey(QuantityMax),
  }, // number — clamp(qty, 0, max) * unit adds
});
export type PricingRule = typeof PricingRule.Type;

/**
 * A time-window price modifier (early-bird discount / late surcharge). `from`/`to`
 * are inclusive-start, exclusive-end calendar dates (the pure evaluator C3 widens
 * each to a half-open UTC millisecond range); `delta` is a SIGNED `CentsDelta` —
 * negative for an early-bird discount, positive for a late surcharge. `id` keys
 * the window for identity-stable CMS merge (the same `ListItemId` idiom every
 * authored list item carries). The `from <= to` ordering and the non-overlap
 * across windows are decode-time invariants below — a window can never invert,
 * and two windows can never both claim the same instant (`first-match` would
 * otherwise be order-dependent, `make-impossible-states-unrepresentable`).
 */
export const TimingWindow = Schema.Struct({
  id: ListItemId,
  from: IsoDate,
  to: IsoDate,
  delta: CentsDelta,
});
export type TimingWindow = typeof TimingWindow.Type;

/**
 * Each window's `from` must not be after its `to` — an inverted window can never
 * cross the boundary. Both ends are zero-padded fixed-width `YYYY-MM-DD`, so a
 * lexicographic compare coincides with chronological order (mirrors
 * `orderedDateRangeFilter`, `content/schema.ts:338`).
 */
const orderedWindowFilter = Schema.makeFilter<{
  readonly from: string;
  readonly to: string;
}>(
  ({ from, to }) =>
    from <= to
      ? undefined
      : `TimingWindow from (${from}) must not be after to (${to})`,
  { title: 'TimingWindow' },
);

/**
 * No two windows may overlap. Each window is half-open `[from, to)` (the C3
 * evaluator widens `to` to an exclusive end), so two windows overlap iff one
 * starts strictly before the other ends AND ends strictly after the other starts.
 * Sorting by `from` reduces the check to adjacent pairs: a sorted window's `from`
 * must be `>=` the previous window's `to` (the previous end is exclusive, so an
 * exact `from == prev.to` abutment is allowed — no shared instant). This keeps
 * `first-match` window selection (Decision 6) order-independent.
 */
const nonOverlappingWindowsFilter = Schema.makeFilter<
  ReadonlyArray<{ readonly from: string; readonly to: string }>
>(
  (windows) => {
    const sorted = [...windows].sort((a, b) => (a.from < b.from ? -1 : 1));
    for (let i = 1; i < sorted.length; i += 1) {
      // `to` is exclusive, so `from === prev.to` abuts without overlapping.
      if (sorted[i]!.from < sorted[i - 1]!.to) {
        return `TimingWindows must not overlap; "${sorted[i - 1]!.from}".."${sorted[i - 1]!.to}" overlaps "${sorted[i]!.from}".."${sorted[i]!.to}"`;
      }
    }
    return undefined;
  },
  { title: 'PricingRules.windows' },
);

/**
 * The pricing dimension attached to a `FormDefinition` (wired in C2 via an
 * `optionalKey` sibling — absence ⇒ unpriced). One form-level `currency`, one
 * form-level `base` fee, a flat list of field-keyed rules, and an optional list
 * of non-overlapping `windows` (early-bird / late modifiers). `windows` is
 * `optionalKey` — a form with no time-based pricing omits it entirely.
 *
 * NOTE: billing-mode selection lives in the authored `party` section on
 * `FormDefinition` (Decision 2b — `party.billingMode.options`), NOT here.
 */
export const PricingRules = Schema.Struct({
  currency: CurrencyCode, // form-level, one currency
  base: Cents, // form-level base fee
  rules: Schema.Array(PricingRule),
  windows: Schema.optionalKey(
    Schema.Array(TimingWindow.check(orderedWindowFilter)).check(
      nonOverlappingWindowsFilter,
    ),
  ),
});
export type PricingRules = typeof PricingRules.Type;

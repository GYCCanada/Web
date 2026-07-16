import { DateTime, Schema } from 'effect';

import { ListItemId } from '../content/schema';
import { FieldName, OptionValue } from './tokens';

/** Non-negative money in the currency's minor unit. */
export const Cents = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand('Cents'),
);
export type Cents = typeof Cents.Type;

/** Signed price adjustment in minor units. */
export const CentsDelta = Schema.Int.pipe(Schema.brand('CentsDelta'));
export type CentsDelta = typeof CentsDelta.Type;

/** Registration v1 settles in Canadian dollars. */
export const CurrencyCode = Schema.Literals(['cad']).pipe(
  Schema.brand('CurrencyCode'),
);
export type CurrencyCode = typeof CurrencyCode.Type;

const OptionPrice = Schema.Struct({ option: OptionValue, amount: Cents });
const QuantityMax = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const PricingRule = Schema.TaggedUnion({
  choice: { field: FieldName, prices: Schema.Array(OptionPrice) },
  multiChoice: { field: FieldName, prices: Schema.Array(OptionPrice) },
  toggle: { field: FieldName, amount: Cents },
  quantity: {
    field: FieldName,
    unit: Cents,
    max: Schema.optionalKey(QuantityMax),
  },
});
export type PricingRule = typeof PricingRule.Type;

/**
 * Exact UTC instants authored from local Conference time in the CMS. Encoding a
 * decoded value always emits a normalized ISO-8601 UTC string.
 */
export const TimingWindow = Schema.Struct({
  id: ListItemId,
  startsAt: Schema.DateTimeUtcFromString,
  endsAt: Schema.DateTimeUtcFromString,
  delta: CentsDelta,
});
export type TimingWindow = typeof TimingWindow.Type;

const orderedWindow = Schema.makeFilter<TimingWindow>(
  (window) =>
    DateTime.toEpochMillis(window.startsAt) <
    DateTime.toEpochMillis(window.endsAt)
      ? undefined
      : 'TimingWindow startsAt must be before endsAt',
  { title: 'TimingWindow' },
);

const nonOverlappingWindows = Schema.makeFilter<
  ReadonlyArray<TimingWindow>
>(
  (windows) => {
    const sorted = [...windows].sort(
      (left, right) =>
        DateTime.toEpochMillis(left.startsAt) -
        DateTime.toEpochMillis(right.startsAt),
    );
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        DateTime.toEpochMillis(current.startsAt) <
          DateTime.toEpochMillis(previous.endsAt)
      ) {
        return `TimingWindows "${previous.id}" and "${current.id}" overlap`;
      }
    }
    return undefined;
  },
  { title: 'PricingRules.windows' },
);

export const PricingRules = Schema.Struct({
  currency: CurrencyCode,
  base: Cents,
  registrationClosesAt: Schema.DateTimeUtcFromString,
  rules: Schema.Array(PricingRule),
  windows: Schema.optionalKey(
    Schema.Array(TimingWindow.check(orderedWindow)).check(
      nonOverlappingWindows,
    ),
  ),
});
export type PricingRules = typeof PricingRules.Type;

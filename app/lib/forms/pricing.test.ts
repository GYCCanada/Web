import { describe, expect, it, test } from 'effect-bun-test';
import { Effect, Schema } from 'effect';

import { Cents, CurrencyCode, PricingRule, PricingRules } from './pricing';

/**
 * C1 — the money brands + the `PricingRule`/`PricingRules` schema.
 *
 * These tests pin the boundary guarantees the pure pricing evaluator (C3) builds
 * on:
 *   - `PricingRules` IS the JSON nested under `pricing` in `forms/<form>.json`, so
 *     a rules value exercising every rule kind round-trips losslessly through
 *     `encode → JSON → decode` (`prove-it-works`);
 *   - the money brands are watertight — `Cents` rejects negative/float/NaN,
 *     `CurrencyCode` rejects any token but `cad`, and the `PricingRule` tag-set is
 *     CLOSED (`make-impossible-states-unrepresentable`, `boundary-discipline`).
 */

const roundTrips = <A, I>(
  schema: Schema.Codec<A, I>,
  value: A,
): Effect.Effect<A, Schema.SchemaError> => {
  const codec = Schema.fromJsonString(schema);
  return Schema.encodeUnknownEffect(codec)(value).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(codec)),
  );
};

const decodeRules = Schema.decodeUnknownResult(PricingRules);
const decodeCents = Schema.decodeUnknownResult(Cents);
const decodeCurrency = Schema.decodeUnknownResult(CurrencyCode);
const decodeRule = Schema.decodeUnknownResult(PricingRule);

/**
 * A rules value exercising every rule kind in one struct — the full pricing
 * surface that round-trips to `forms/<form>.json`.
 */
const fullRulesJson = {
  currency: 'cad',
  base: 5000,
  rules: [
    {
      _tag: 'choice',
      field: 'tShirtSize',
      prices: [
        { option: 'small', amount: 0 },
        { option: 'large', amount: 500 },
      ],
    },
    {
      _tag: 'multiChoice',
      field: 'workshops',
      prices: [
        { option: 'photography', amount: 1500 },
        { option: 'music', amount: 1500 },
      ],
    },
    { _tag: 'toggle', field: 'addBanquet', amount: 2500 },
  ],
} as const;

describe('PricingRules round-trip (encoded rules ARE the on-bucket JSON)', () => {
  it.effect(
    'a rules value exercising every rule kind round-trips losslessly',
    () =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(PricingRules)(
          fullRulesJson,
        );
        const restored = yield* roundTrips(PricingRules, decoded);
        expect(restored).toEqual(decoded);
      }),
  );

  test('a minimal rules value (no rules) decodes', () => {
    expect(
      decodeRules({ currency: 'cad', base: 0, rules: [] })._tag,
    ).toBe('Success');
  });
});

describe('Cents — branded non-negative integer minor units', () => {
  test('a non-negative integer is accepted', () => {
    expect(decodeCents(0)._tag).toBe('Success');
    expect(decodeCents(5000)._tag).toBe('Success');
  });

  test('a negative amount is rejected', () => {
    expect(decodeCents(-1)._tag).toBe('Failure');
  });

  test('a fractional amount is rejected (cents are whole minor units)', () => {
    expect(decodeCents(12.5)._tag).toBe('Failure');
  });

  test('NaN is rejected', () => {
    expect(decodeCents(Number.NaN)._tag).toBe('Failure');
  });
});

describe('CurrencyCode — closed currency literal', () => {
  test('cad is accepted', () => {
    expect(decodeCurrency('cad')._tag).toBe('Success');
  });

  test('any other currency token is rejected', () => {
    expect(decodeCurrency('usd')._tag).toBe('Failure');
    expect(decodeCurrency('CAD')._tag).toBe('Failure');
    expect(decodeCurrency('')._tag).toBe('Failure');
  });
});

describe('PricingRule — closed tag set', () => {
  test('the three rule kinds decode at the PricingRule boundary', () => {
    expect(
      decodeRule({ _tag: 'choice', field: 'size', prices: [] })._tag,
    ).toBe('Success');
    expect(
      decodeRule({ _tag: 'multiChoice', field: 'workshops', prices: [] })._tag,
    ).toBe('Success');
    expect(
      decodeRule({ _tag: 'toggle', field: 'addBanquet', amount: 2500 })._tag,
    ).toBe('Success');
  });

  test('an unknown rule `_tag` is rejected', () => {
    expect(
      decodeRule({ _tag: 'quantity', field: 'nights', unit: 100, max: 5 })._tag,
    ).toBe('Failure');
  });

  test('a rule field carrying a negative option price is rejected (Cents brand)', () => {
    expect(
      decodeRule({
        _tag: 'choice',
        field: 'size',
        prices: [{ option: 'large', amount: -500 }],
      })._tag,
    ).toBe('Failure');
  });

  test('a dotted / invalid field name is rejected (FieldName brand)', () => {
    expect(
      decodeRule({ _tag: 'toggle', field: 'add.banquet', amount: 100 })._tag,
    ).toBe('Failure');
  });
});

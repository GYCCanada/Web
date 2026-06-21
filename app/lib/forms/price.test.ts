import { describe, expect, test } from 'effect-bun-test';
import { Schema } from 'effect';

import { FormDefinition } from './definition';
import { priceGroup, priceRegistrant } from './price';

import type { DecodedForm } from './decode';

/**
 * C3 — the pure `priceRegistrant`/`priceGroup` total evaluator (Decision 4/6).
 *
 * These tests pin the price fold as a closed arithmetic over the DECODED
 * submission (never the raw POST string): `base + Σ(active priced choices) +
 * windowDelta`, clamped at 0. The evaluator is pure — `nowMillis` is injected, so
 * every timing assertion fixes the instant directly (no `Clock`, no `Date.now()`).
 *
 * The narrowing contract is exercised one test PER rule kind (`choice` /
 * `multiChoice` / `toggle`) against the actual decoded runtime values the leaf
 * codecs produce (`decode.ts`): a `choice` reads one `OptionValue` string, a
 * `multiChoice` an array of them, a `toggle` a real `boolean`. The activation
 * guard is a no-op pass-through here (no `activeWhenEquals` rules) — its
 * conditional path is exercised in C4c.
 */

const text = (en: string, fr: string) => ({ en, fr });

/** The priced fields the rules below key off — a literal, an array, a checkbox. */
const pricedFields = [
  {
    _tag: 'literal',
    name: 'tShirtSize',
    label: text('Size', 'Taille'),
    requiredMessage: 'registration.form.gender.required',
    options: [
      { value: 'small', label: text('Small', 'Petit') },
      { value: 'large', label: text('Large', 'Grand') },
    ],
  },
  {
    _tag: 'arrayOfLiteral',
    name: 'workshops',
    label: text('Workshops', 'Ateliers'),
    requiredMessage: 'registration.form.merch.required',
    options: [
      { value: 'photography', label: text('Photo', 'Photo') },
      { value: 'music', label: text('Music', 'Musique') },
    ],
  },
  {
    _tag: 'checkboxBoolean',
    name: 'addBanquet',
    label: text('Banquet', 'Banquet'),
    requiredMessage: 'registration.form.tos.required',
  },
] as const;

/** All three rule kinds keyed to the priced fields. */
const pricingRules = [
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
] as const;

/** A decoded priced definition (base 5000, the three rules, no windows). */
const definition = Schema.decodeUnknownSync(FormDefinition)({
  title: text('Registration', 'Inscription'),
  fields: pricedFields,
  pricing: { currency: 'cad', base: 5000, rules: pricingRules },
});

/** A decoded definition with an early-bird window and a late surcharge window. */
const windowedDefinition = Schema.decodeUnknownSync(FormDefinition)({
  title: text('Registration', 'Inscription'),
  fields: pricedFields,
  pricing: {
    currency: 'cad',
    base: 5000,
    rules: [],
    windows: [
      {
        id: 'earlyBirdWindow000000',
        from: '2026-01-01',
        to: '2026-03-01',
        delta: -1000,
      },
      {
        id: 'lateSurchargeWindow00',
        from: '2026-06-01',
        to: '2026-07-01',
        delta: 1500,
      },
    ],
  },
});

/** A decoded definition with a discount window deeper than the base (clamp test). */
const deepDiscountDefinition = Schema.decodeUnknownSync(FormDefinition)({
  title: text('Registration', 'Inscription'),
  fields: pricedFields,
  pricing: {
    currency: 'cad',
    base: 500,
    rules: [],
    windows: [
      {
        id: 'deepDiscountWindow000',
        from: '2026-01-01',
        to: '2026-03-01',
        delta: -1000,
      },
    ],
  },
});

/** A decoded definition with NO pricing sibling — the unpriced form. */
const unpricedDefinition = Schema.decodeUnknownSync(FormDefinition)({
  title: text('Volunteer', 'Bénévole'),
  fields: pricedFields,
});

/** A `now` outside every window (between the two windowed ranges). */
const NOW_BETWEEN_WINDOWS = Date.UTC(2026, 3, 15); // 2026-04-15

/**
 * The evaluators return a branded `Cents`; unwrap to a plain `number` so the
 * `toBe` literals below assert against the raw minor-unit total (the brand is
 * runtime-transparent — `Cents` IS the number).
 */
const cents = (value: { valueOf(): number }): number => Number(value);

/** A decoded submission — the values the leaf codecs produce, by name. */
const submission = (overrides: DecodedForm = {}): DecodedForm => ({
  tShirtSize: 'small',
  workshops: [],
  addBanquet: false,
  ...overrides,
});

describe('priceRegistrant — base + active priced choices', () => {
  test('base only — no priced selection contributes', () => {
    expect(
      cents(priceRegistrant(definition, submission(), NOW_BETWEEN_WINDOWS)),
    ).toBe(5000);
  });

  test('base + choice — the selected option price adds (literal kind)', () => {
    expect(
      cents(
        priceRegistrant(
          definition,
          submission({ tShirtSize: 'large' }),
          NOW_BETWEEN_WINDOWS,
        ),
      ),
    ).toBe(5500);
  });

  test('base + toggle on/off (checkboxBoolean kind)', () => {
    expect(
      cents(
        priceRegistrant(
          definition,
          submission({ addBanquet: true }),
          NOW_BETWEEN_WINDOWS,
        ),
      ),
    ).toBe(7500);
    expect(
      cents(
        priceRegistrant(
          definition,
          submission({ addBanquet: false }),
          NOW_BETWEEN_WINDOWS,
        ),
      ),
    ).toBe(5000);
  });

  test('base + multiChoice — each selected option adds (arrayOfLiteral kind)', () => {
    expect(
      cents(
        priceRegistrant(
          definition,
          submission({ workshops: ['photography', 'music'] }),
          NOW_BETWEEN_WINDOWS,
        ),
      ),
    ).toBe(8000); // 5000 + 1500 + 1500
  });

  test('an unpriced option in a selection contributes 0', () => {
    expect(
      cents(
        priceRegistrant(
          definition,
          submission({ workshops: ['photography'] }),
          NOW_BETWEEN_WINDOWS,
        ),
      ),
    ).toBe(6500); // 5000 + 1500
  });

  test('every priced choice combines additively', () => {
    expect(
      cents(
        priceRegistrant(
          definition,
          submission({
            tShirtSize: 'large',
            workshops: ['photography', 'music'],
            addBanquet: true,
          }),
          NOW_BETWEEN_WINDOWS,
        ),
      ),
    ).toBe(11000); // 5000 + 500 + 3000 + 2500
  });
});

describe('priceRegistrant — timing windows (half-open [from, to) UTC)', () => {
  test('a now INSIDE the early-bird window applies the discount', () => {
    expect(
      cents(
        priceRegistrant(windowedDefinition, submission(), Date.UTC(2026, 1, 15)),
      ),
    ).toBe(4000); // 5000 - 1000, 2026-02-15 ∈ [Jan 1, Mar 1)
  });

  test('a now OUTSIDE every window applies no delta', () => {
    expect(
      cents(
        priceRegistrant(windowedDefinition, submission(), NOW_BETWEEN_WINDOWS),
      ),
    ).toBe(5000); // 2026-04-15 ∈ no window
  });

  test('a now in the late window applies the surcharge', () => {
    expect(
      cents(
        priceRegistrant(windowedDefinition, submission(), Date.UTC(2026, 5, 15)),
      ),
    ).toBe(6500); // 5000 + 1500, 2026-06-15 ∈ [Jun 1, Jul 1)
  });

  test('the START boundary is inclusive (now == from applies)', () => {
    expect(
      cents(
        priceRegistrant(windowedDefinition, submission(), Date.UTC(2026, 0, 1)),
      ),
    ).toBe(4000); // 2026-01-01 == from ⇒ inside
  });

  test('the END boundary is exclusive (now == to does NOT apply)', () => {
    expect(
      cents(
        priceRegistrant(windowedDefinition, submission(), Date.UTC(2026, 2, 1)),
      ),
    ).toBe(5000); // 2026-03-01 == to ⇒ outside the early-bird window
  });
});

describe('priceRegistrant — clamping & unpriced', () => {
  test('a discount deeper than the base clamps at 0 (never negative)', () => {
    expect(
      cents(
        priceRegistrant(deepDiscountDefinition, submission(), Date.UTC(2026, 1, 15)),
      ),
    ).toBe(0); // 500 - 1000 ⇒ max(0, -500)
  });

  test('a definition with no pricing sibling prices to 0', () => {
    expect(
      cents(
        priceRegistrant(unpricedDefinition, submission(), NOW_BETWEEN_WINDOWS),
      ),
    ).toBe(0);
  });
});

describe('priceGroup — sum of each registrant under one instant', () => {
  test('two registrants sum their individual prices', () => {
    const party = [
      submission({ tShirtSize: 'large' }), // 5500
      submission({ addBanquet: true }), // 7500
    ];
    expect(cents(priceGroup(definition, party, NOW_BETWEEN_WINDOWS))).toBe(13000);
  });

  test('an empty party sums to 0', () => {
    expect(cents(priceGroup(definition, [], NOW_BETWEEN_WINDOWS))).toBe(0);
  });

  test('every registrant is priced under the SAME injected instant', () => {
    const party = [submission(), submission()];
    // Both inside the early-bird window ⇒ each 4000 ⇒ 8000.
    expect(
      cents(priceGroup(windowedDefinition, party, Date.UTC(2026, 1, 15))),
    ).toBe(8000);
  });
});

import { describe, expect, test } from 'effect-bun-test';
import { Result, Schema } from 'effect';

import { decodeForm } from './decode';
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

/**
 * C4c — activation × pricing orthogonality (Decision 4/5). The C3 fold already
 * routes every rule through the shared `isActiveByName` guard; here we exercise
 * the conditional path: a priced `activeWhenEquals` target contributes ONLY when
 * its predicate holds over a sibling, and an inactive field contributes 0
 * regardless of any rule keyed to it.
 *
 * `price-eligibility = isActive(field) ∧ ∃ pricingRule(field)` — two independent
 * predicates AND-ed. The four combos are all representable and all pinned below:
 * active∧priced charges, active∧unpriced 0, inactive∧priced 0, inactive∧unpriced
 * 0. The activation guard and the pricing-rule presence are NEVER conflated — an
 * active field with no rule adds 0; an inactive field with a rule adds 0.
 *
 * The complementary half — a PRESENT-but-inactive value can never reach `price()`
 * because the decode boundary rejects it as an out-of-form payload — is asserted
 * directly against `decodeForm` (the smuggle test), so the orthogonality holds end
 * to end, not only inside this pure fold.
 */

/** A field/option set carrying two gated targets — one priced, one unpriced. */
const gatedFields = [
  {
    _tag: 'literal',
    name: 'addBanquet',
    label: text('Banquet?', 'Banquet?'),
    requiredMessage: 'registration.form.gender.required',
    options: [
      { value: 'yes', label: text('Yes', 'Oui') },
      { value: 'no', label: text('No', 'Non') },
    ],
  },
  {
    // The PRICED gated target — a `choice` rule keys off it (active∧priced).
    _tag: 'literal',
    name: 'banquetSeats',
    label: text('Seats', 'Places'),
    requiredMessage: 'registration.form.church.required',
    options: [
      { value: 'single', label: text('Single', 'Simple') },
      { value: 'couple', label: text('Couple', 'Couple') },
    ],
  },
  {
    // The UNPRICED gated target — NO pricing rule names it (active∧unpriced).
    _tag: 'optionalText',
    name: 'banquetNote',
    label: text('Note', 'Note'),
    invalidMessage: 'registration.form.other.required',
  },
] as const;

/** Both targets active only when `addBanquet == 'yes'` (same-scope sibling). */
const gatedRules = [
  {
    _tag: 'activeWhenEquals',
    predicate: { _tag: 'literalEquals', when: 'addBanquet', equals: ['yes'] },
    target: 'banquetSeats',
  },
  {
    _tag: 'activeWhenEquals',
    predicate: { _tag: 'literalEquals', when: 'addBanquet', equals: ['yes'] },
    target: 'banquetNote',
  },
] as const;

/** Base 5000; only `banquetSeats` carries a price (the unpriced target has none). */
const gatedDefinition = Schema.decodeUnknownSync(FormDefinition)({
  title: text('Registration', 'Inscription'),
  fields: gatedFields,
  pricing: {
    currency: 'cad',
    base: 5000,
    rules: [
      {
        _tag: 'choice',
        field: 'banquetSeats',
        prices: [
          { option: 'single', amount: 2000 },
          { option: 'couple', amount: 3500 },
        ],
      },
    ],
  },
  rules: gatedRules,
});

describe('priceRegistrant — activation gates a priced contribution (C4c)', () => {
  test('when ∈ predicate ⇒ the priced active target is INCLUDED', () => {
    // addBanquet == 'yes' ⇒ banquetSeats active ⇒ its choice price adds.
    expect(
      cents(
        priceRegistrant(
          gatedDefinition,
          { addBanquet: 'yes', banquetSeats: 'couple' },
          NOW_BETWEEN_WINDOWS,
        ),
      ),
    ).toBe(8500); // 5000 + 3500
  });

  test('when ∉ predicate ⇒ the priced inactive target is EXCLUDED', () => {
    // addBanquet == 'no' ⇒ banquetSeats inactive ⇒ contributes 0 even though a
    // rule keys off it (the absent target is the only valid decoded shape).
    expect(
      cents(
        priceRegistrant(
          gatedDefinition,
          { addBanquet: 'no' },
          NOW_BETWEEN_WINDOWS,
        ),
      ),
    ).toBe(5000); // base only — the inactive rule contributes nothing
  });

  test('a present-but-inactive value is rejected at DECODE — price never sees it', () => {
    // The smuggle: a `banquetSeats` value while `addBanquet == 'no'`. The decode
    // boundary rejects it as an out-of-form payload (registrar-plan Decision 5),
    // so a smuggled priced value can NEVER reach the pure fold above.
    const smuggled = decodeForm(gatedDefinition, {
      addBanquet: 'no',
      banquetSeats: 'couple',
    });
    expect(Result.isSuccess(smuggled)).toBe(false);

    // And the legitimate inactive submission (target absent) decodes, then prices
    // to base only — proving the guard and the boundary agree.
    const inactive = decodeForm(gatedDefinition, { addBanquet: 'no' });
    expect(Result.isSuccess(inactive)).toBe(true);
    if (Result.isSuccess(inactive)) {
      expect(
        cents(priceRegistrant(gatedDefinition, inactive.success, NOW_BETWEEN_WINDOWS)),
      ).toBe(5000);
    }
  });
});

describe('priceRegistrant — the four orthogonality combos (C4c)', () => {
  test('active ∧ priced ⇒ charges (the rule contributes)', () => {
    expect(
      cents(
        priceRegistrant(
          gatedDefinition,
          { addBanquet: 'yes', banquetSeats: 'single' },
          NOW_BETWEEN_WINDOWS,
        ),
      ),
    ).toBe(7000); // 5000 + 2000
  });

  test('active ∧ unpriced ⇒ 0 (no rule names the active target)', () => {
    // banquetNote is active (addBanquet == 'yes') but has NO pricing rule ⇒ it
    // contributes 0; the priced sibling adds, the unpriced one does not.
    expect(
      cents(
        priceRegistrant(
          gatedDefinition,
          { addBanquet: 'yes', banquetSeats: 'single', banquetNote: 'window seat' },
          NOW_BETWEEN_WINDOWS,
        ),
      ),
    ).toBe(7000); // 5000 + 2000 — the active unpriced note adds nothing
  });

  test('inactive ∧ priced ⇒ 0 (the rule is gated off)', () => {
    expect(
      cents(
        priceRegistrant(
          gatedDefinition,
          { addBanquet: 'no' },
          NOW_BETWEEN_WINDOWS,
        ),
      ),
    ).toBe(5000); // base only — the priced target is inactive
  });

  test('inactive ∧ unpriced ⇒ 0 (no rule, gated off — base only)', () => {
    // Both gated targets inactive; one priced, one unpriced — neither contributes.
    expect(
      cents(
        priceRegistrant(
          gatedDefinition,
          { addBanquet: 'no' },
          NOW_BETWEEN_WINDOWS,
        ),
      ),
    ).toBe(5000);
  });
});

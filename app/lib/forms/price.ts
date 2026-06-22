import { activationIndex, isActiveByName } from './activation';
import { Cents, type PricingRule, type TimingWindow } from './pricing';

import type { DecodedForm } from './decode';
import type { FormDefinition } from './definition';

/**
 * The pure total-price evaluator (registrar plan Decision 4/6). Given a decoded
 * `FormDefinition` (its `pricing` sibling already validated against the field
 * graph at the decode boundary, Decision 1) and a decoded submission, it folds
 * `base + Σ(active priced choices) + windowDelta` into a single `Cents` total.
 *
 * PURE by construction — no `Effect`, no `Clock`, no `Date.now()`. The current
 * instant is injected as `nowMillis` so the timing windows (Decision 6) are
 * deterministic under `TestClock`: the server passes `Clock.currentTimeMillis`,
 * the client passes `Date.now()`, a test passes a frozen millisecond. This is the
 * one module that reads the pricing dimension; it never writes a Stripe boundary.
 *
 * `DecodedForm` is `Record<string, unknown>` (`decode.ts`), so every rule kind
 * narrows DEFENSIVELY against the actual decoded runtime value before it
 * contributes (the Decision-4 table) — a `choice` reads a branded `OptionValue`
 * string, a `multiChoice` an array of them, a `toggle` a real `boolean` (never the
 * raw `'on'`/`'true'`, which the decoder has already transformed away).
 */

/**
 * One rule's price contribution over a decoded submission — the Decision-4
 * narrowing table, one arm per `PricingRule` kind. Reads the DECODED value
 * (`decode.ts`'s leaf codecs), never the raw POST string; an unmatched/absent
 * value contributes `0` (a choice not yet made, an option without a price entry).
 * The caller has already proven the field is ACTIVE — an inactive field is short-
 * circuited to `0` upstream (activation × pricing orthogonality, Decision 5).
 */
const contributionOf = (rule: PricingRule, decoded: DecodedForm): number => {
  switch (rule._tag) {
    case 'choice': {
      // A `literal` decodes to one branded `OptionValue` string; match its price.
      const value = decoded[rule.field];
      return rule.prices.find((price) => price.option === value)?.amount ?? 0;
    }
    case 'multiChoice': {
      // An `arrayOfLiteral` decodes to an array of `OptionValue` strings; sum the
      // price of each SELECTED option (an unpriced selection adds 0).
      const value = decoded[rule.field];
      if (!Array.isArray(value)) return 0;
      return value.reduce<number>(
        (sum, element) =>
          sum +
          (rule.prices.find((price) => price.option === element)?.amount ?? 0),
        0,
      );
    }
    case 'toggle': {
      // A `checkboxBoolean` decodes to a real `boolean`; the amount adds iff true.
      return decoded[rule.field] === true ? rule.amount : 0;
    }
    case 'quantity': {
      // A `number` decodes to a real integer; the entered count is CLAMPED to
      // `[0, max]` (max absent ⇒ no upper bound above zero) before multiplying by
      // the per-item `unit`, so a smuggled huge/negative count can never mint an
      // unbounded or negative charge (`make-impossible-states-unrepresentable`).
      // A non-numeric/absent value (an unfilled optional count) contributes 0.
      const value = decoded[rule.field];
      if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
      const capped = rule.max === undefined ? value : Math.min(value, rule.max);
      const clamped = Math.max(0, capped);
      return clamped * rule.unit;
    }
  }
};

/**
 * Widen an inclusive-start `YYYY-MM-DD` to its `00:00:00 UTC` start millisecond.
 * The `IsoDate` brand has already proven the string is a real calendar date, so
 * the slices are present and numeric — `Date.UTC` cannot roll over here.
 */
const toStartMs = (isoDate: string): number =>
  Date.UTC(
    Number.parseInt(isoDate.slice(0, 4), 10),
    Number.parseInt(isoDate.slice(5, 7), 10) - 1,
    Number.parseInt(isoDate.slice(8, 10), 10),
  );

/**
 * The half-open window delta (Decision 6): the signed delta of the FIRST window
 * whose `[from, to)` UTC range contains `now`, else `0`. `to` is the EXCLUSIVE end
 * (`00:00:00 UTC` of the `to` day), so a `now == to` falls into the NEXT window,
 * never two at once. The decode-time non-overlap filter (`pricing.ts`) makes
 * windows mutually exclusive, so `first-match` is total and order-independent.
 */
const windowDelta = (
  windows: ReadonlyArray<TimingWindow>,
  nowMillis: number,
): number => {
  for (const window of windows) {
    const fromMs = toStartMs(window.from);
    const toExclusiveMs = toStartMs(window.to); // half-open: [from, to)
    if (nowMillis >= fromMs && nowMillis < toExclusiveMs) {
      return window.delta;
    }
  }
  return 0;
};

/**
 * The price of ONE registrant (the route owns the `{ registrants: [...] }` array
 * shell and calls this per element). `base + Σ(active priced choices) +
 * windowDelta`, clamped at `0` so a discount window deeper than the base can never
 * mint a negative price. An absent `pricing` sibling (`optionalKey`, Decision 3)
 * means the form is unpriced ⇒ `0`.
 *
 * Each rule contributes ONLY when its field is ACTIVE (Decision 5) — the shared
 * `isActiveByName` reads the same decoded scope every consumer reads; a field with
 * no `activeWhenEquals` rule is always active (the always-true pass-through this
 * commit relies on; the conditional path is exercised in C4c).
 */
export const priceRegistrant = (
  definition: FormDefinition,
  decoded: DecodedForm,
  nowMillis: number,
): Cents => {
  const pricing = definition.pricing;
  if (pricing === undefined) return Cents.make(0);

  const index = activationIndex(definition);
  let total: number = pricing.base;
  for (const rule of pricing.rules) {
    total += isActiveByName(rule.field, index, decoded)
      ? contributionOf(rule, decoded)
      : 0;
  }
  total += windowDelta(pricing.windows ?? [], nowMillis);

  return Cents.make(Math.max(0, total)); // never negative (runtime clamp)
};

/**
 * The group total (Decision 2): each registrant's price summed under the SAME
 * `nowMillis`, so a single party-wide checkout freezes one consistent amount. An
 * empty party sums to `0` (the route's `nonEmptyParty` shell guard rejects a
 * zero-registrant submission upstream).
 */
export const priceGroup = (
  definition: FormDefinition,
  registrants: ReadonlyArray<DecodedForm>,
  nowMillis: number,
): Cents =>
  Cents.make(
    registrants.reduce<number>(
      (sum, registrant) =>
        sum + priceRegistrant(definition, registrant, nowMillis),
      0,
    ),
  );

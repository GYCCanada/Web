import { DateTime } from 'effect';

import { activationIndex, isActiveByName } from './activation';
import { Cents, type PricingRule, type TimingWindow } from './pricing';

import type { DecodedForm } from './decode';
import type { FormDefinition } from './definition';

const contributionOf = (rule: PricingRule, decoded: DecodedForm): number => {
  switch (rule._tag) {
    case 'choice': {
      const value = decoded[rule.field];
      return rule.prices.find((price) => price.option === value)?.amount ?? 0;
    }
    case 'multiChoice': {
      const value = decoded[rule.field];
      if (!Array.isArray(value)) return 0;
      return value.reduce<number>(
        (sum, element) =>
          sum +
          (rule.prices.find((price) => price.option === element)?.amount ?? 0),
        0,
      );
    }
    case 'toggle':
      return decoded[rule.field] === true ? rule.amount : 0;
    case 'quantity': {
      const value = decoded[rule.field];
      if (typeof value !== 'number' || !Number.isInteger(value)) return 0;
      const capped = rule.max === undefined ? value : Math.min(value, rule.max);
      return Math.max(0, capped) * rule.unit;
    }
  }
};

const windowDelta = (
  windows: ReadonlyArray<TimingWindow>,
  pricedAtMillis: number,
): number =>
  windows.find(
    (window) =>
      pricedAtMillis >= DateTime.toEpochMillis(window.startsAt) &&
      pricedAtMillis < DateTime.toEpochMillis(window.endsAt),
  )?.delta ?? 0;

export const priceRegistrant = (
  definition: FormDefinition,
  decoded: DecodedForm,
  pricedAtMillis: number,
): Cents => {
  const pricing = definition.pricing;
  if (pricing === undefined) return Cents.make(0);

  const active = activationIndex(definition);
  let total: number = pricing.base;
  for (const rule of pricing.rules) {
    if (isActiveByName(rule.field, active, decoded)) {
      total += contributionOf(rule, decoded);
    }
  }
  total += windowDelta(pricing.windows ?? [], pricedAtMillis);
  return Cents.make(Math.max(0, total));
};

export const priceGroup = (
  definition: FormDefinition,
  registrants: ReadonlyArray<DecodedForm>,
  pricedAtMillis: number,
): Cents =>
  Cents.make(
    registrants.reduce(
      (sum, registrant) =>
        sum + priceRegistrant(definition, registrant, pricedAtMillis),
      0,
    ),
  );

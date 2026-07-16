import type { ActiveWhen, CrossFieldRule, FormDefinition } from './definition';

export type ActivationScope = Readonly<Record<string, unknown>>;
type ActivationRule = Extract<CrossFieldRule, { _tag: 'activeWhenEquals' }>;

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

export const activationIndex = (
  definition: FormDefinition,
): ReadonlyMap<string, ActivationRule> => {
  const index = new Map<string, ActivationRule>();
  for (const rule of definition.rules ?? []) {
    if (rule._tag === 'activeWhenEquals') index.set(rule.target, rule);
  }
  return index;
};

export const isActiveByName = (
  fieldName: string,
  index: ReadonlyMap<string, ActivationRule>,
  scope: ActivationScope,
): boolean => {
  const rule = index.get(fieldName);
  return rule === undefined ? true : predicateHolds(rule.predicate, scope);
};

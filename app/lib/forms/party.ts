import { Schema } from 'effect';

import { Text } from '../content/schema';
import { MessageKey } from './tokens';

export const BillingMode = Schema.Literals(['group', 'perRegistrant']);
export type BillingMode = typeof BillingMode.Type;

const nonEmptyBillingModes = Schema.makeFilter<{
  readonly group?: unknown;
  readonly perRegistrant?: unknown;
}>(
  (options) =>
    Object.keys(options).length > 0
      ? undefined
      : 'a party billing-mode selector must offer at least one mode',
  { title: 'BillingMode.nonEmptyOptions' },
);

const BillingModeSelector = Schema.Struct({
  label: Text,
  requiredMessage: MessageKey,
  options: Schema.Struct({
    group: Schema.optionalKey(Text),
    perRegistrant: Schema.optionalKey(Text),
  }).check(nonEmptyBillingModes),
});

export const PayerFields = Schema.Struct({
  label: Text,
  nameField: Schema.Struct({ label: Text, requiredMessage: MessageKey }),
  emailField: Schema.Struct({
    label: Text,
    requiredMessage: MessageKey,
    invalidMessage: MessageKey,
  }),
});
export type PayerFields = typeof PayerFields.Type;

export const PartySection = Schema.Struct({
  intro: Schema.optionalKey(Text),
  billingMode: BillingModeSelector,
  payer: Schema.optionalKey(PayerFields),
});
export type PartySection = typeof PartySection.Type;

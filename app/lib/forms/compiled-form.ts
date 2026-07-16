import { DateTime, Result, Schema, SchemaParser } from 'effect';
import type { Issue } from 'effect/SchemaIssue';

import {
  type DecodedForm,
  definitionToSchema,
} from './decode';
import type { FormDefinition } from './definition';
import { priceGroup, priceRegistrant } from './price';
import { Cents, type CurrencyCode } from './pricing';
import {
  type RegistrationShellDecoded,
  registrationShellDecoder,
} from './registration-shell';

export type ReadinessIssue = {
  readonly code:
    | 'registration-party-missing'
    | 'registration-pricing-missing'
    | 'registration-closed'
    | 'per-registrant-email-missing';
  readonly message: string;
};

export type QuotedOrder =
  | {
      readonly _tag: 'group';
      readonly amount: Cents;
      readonly receiptEmail: string;
    }
  | {
      readonly _tag: 'registrant';
      readonly ordinal: number;
      readonly amount: Cents;
      readonly receiptEmail: string;
    };

export type RegistrationQuote = {
  readonly mode: 'group' | 'perRegistrant';
  readonly currency: CurrencyCode;
  readonly pricedAt: DateTime.Utc;
  readonly expiresAt: DateTime.Utc;
  readonly registrationClosesAt: DateTime.Utc;
  readonly orders: ReadonlyArray<QuotedOrder>;
  readonly total: Cents;
};

export type QuoteResult =
  | { readonly ok: true; readonly quote: RegistrationQuote }
  | { readonly ok: false; readonly issues: ReadonlyArray<ReadinessIssue> };

export type CompiledForm = {
  readonly renderModel: FormDefinition;
  readonly codec: Schema.Codec<DecodedForm, Record<string, unknown>>;
  readonly decode: (
    payload: unknown,
  ) => Result.Result<DecodedForm, Issue>;
  readonly decodeRegistration: (
    payload: unknown,
  ) => Result.Result<RegistrationShellDecoded, Issue>;
  readonly readiness: (
    at: DateTime.Utc,
  ) => ReadonlyArray<ReadinessIssue>;
  readonly quoteRegistration: (
    shell: RegistrationShellDecoded,
    pricedAt: DateTime.Utc,
  ) => QuoteResult;
};

const registrationReadiness = (
  definition: FormDefinition,
  at: DateTime.Utc,
): ReadonlyArray<ReadinessIssue> => {
  const issues: ReadinessIssue[] = [];
  if (definition.party === undefined) {
    issues.push({
      code: 'registration-party-missing',
      message: 'Registration billing modes are not configured.',
    });
  }
  const pricing = definition.pricing;
  if (pricing === undefined) {
    issues.push({
      code: 'registration-pricing-missing',
      message: 'Registration pricing and its deadline are not configured.',
    });
  } else if (
    DateTime.toEpochMillis(at) >=
    DateTime.toEpochMillis(pricing.registrationClosesAt)
  ) {
    issues.push({
      code: 'registration-closed',
      message: 'The registration deadline has passed.',
    });
  }

  if (definition.party?.billingMode.options.perRegistrant !== undefined) {
    const email = definition.fields.find(
      (field) => field._tag === 'email' && field.name === 'email',
    );
    if (email === undefined) {
      issues.push({
        code: 'per-registrant-email-missing',
        message: 'Per-registrant billing requires a registrant email field.',
      });
    }
  }
  return issues;
};

const registrationExpiry = (
  pricedAt: DateTime.Utc,
  closesAt: DateTime.Utc,
): DateTime.Utc =>
  DateTime.makeUnsafe(
    Math.min(
      DateTime.toEpochMillis(pricedAt) + 24 * 60 * 60 * 1_000,
      DateTime.toEpochMillis(closesAt),
    ),
  );

export const compileForm = (definition: FormDefinition): CompiledForm => {
  const formSchema = definitionToSchema(definition);
  const decodeRegistration = registrationShellDecoder(definition);

  return {
    renderModel: definition,
    codec: formSchema,
    decode: SchemaParser.decodeUnknownResult(formSchema),
    decodeRegistration,
    readiness: (at) => registrationReadiness(definition, at),
    quoteRegistration: (shell, pricedAt) => {
      const issues = registrationReadiness(definition, pricedAt);
      const pricing = definition.pricing;
      if (issues.length > 0 || pricing === undefined || !('party' in shell)) {
        return { ok: false, issues };
      }

      const pricedAtMillis = DateTime.toEpochMillis(pricedAt);
      const expiresAt = registrationExpiry(
        pricedAt,
        pricing.registrationClosesAt,
      );
      const orders: ReadonlyArray<QuotedOrder> =
        shell.party._tag === 'group'
          ? [
              {
                _tag: 'group',
                amount: priceGroup(
                  definition,
                  shell.registrants,
                  pricedAtMillis,
                ),
                receiptEmail: shell.party.payer.email,
              },
            ]
          : shell.registrants.map((registrant, ordinal) => ({
              _tag: 'registrant' as const,
              ordinal,
              amount: priceRegistrant(
                definition,
                registrant,
                pricedAtMillis,
              ),
              receiptEmail:
                typeof registrant['email'] === 'string'
                  ? registrant['email']
                  : '',
            }));
      const total = Cents.make(
        orders.reduce((sum, order) => sum + order.amount, 0),
      );
      return {
        ok: true,
        quote: {
          mode: shell.party._tag,
          currency: pricing.currency,
          pricedAt,
          expiresAt,
          registrationClosesAt: pricing.registrationClosesAt,
          orders,
          total,
        },
      };
    },
  };
};

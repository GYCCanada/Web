import { Result, Schema, SchemaGetter, SchemaParser } from 'effect';
import type { Issue } from 'effect/SchemaIssue';

import {
  type DecodedForm,
  definitionToSchema,
  email,
  requiredString,
} from './decode';
import type { FormDefinition } from './definition';
import { type BillingMode, type PartySection } from './party';
import { MessageKey } from './tokens';

export type Payer = { readonly name: string; readonly email: string };

export type RegistrationShellDecoded =
  | { readonly registrants: ReadonlyArray<DecodedForm> }
  | {
      readonly party: { readonly _tag: 'group'; readonly payer: Payer };
      readonly registrants: ReadonlyArray<DecodedForm>;
    }
  | {
      readonly party: { readonly _tag: 'perRegistrant' };
      readonly registrants: ReadonlyArray<DecodedForm>;
    };

const payerCodec = (payer: NonNullable<PartySection['payer']>) =>
  Schema.Struct({
    name: requiredString(payer.nameField.requiredMessage),
    email: email(
      payer.emailField.requiredMessage,
      payer.emailField.invalidMessage,
    ),
  });

const nonEmptyParty = Schema.makeFilter(
  (shell: { readonly registrants: ReadonlyArray<unknown> }) =>
    shell.registrants.length > 0
      ? undefined
      : {
          path: ['registrants'],
          issue: 'registration.form.type.required' as const,
        },
  { title: 'registrationShell.nonEmptyParty' },
);

const dropBlankRegistrantEmails = (
  registrants: ReadonlyArray<unknown>,
): Array<Record<string, unknown>> =>
  registrants.map((registrant) => {
    if (
      registrant === null ||
      typeof registrant !== 'object' ||
      Array.isArray(registrant)
    ) {
      return {};
    }
    const record = registrant as Record<string, unknown>;
    if (record['email'] !== '') return record;
    const { email: _blank, ...withoutEmail } = record;
    return withoutEmail;
  });

const withOptionalRegistrantEmail = (
  definition: FormDefinition,
): FormDefinition => ({
  ...definition,
  fields: definition.fields.map((field) =>
    field._tag === 'email' && field.name === 'email'
      ? { ...field, optional: true }
      : field,
  ),
});

const groupRegistrants = (registrant: Schema.Codec<Record<string, unknown>>) =>
  Schema.mutable(Schema.Array(Schema.Unknown)).pipe(
    Schema.decodeTo(Schema.mutable(Schema.Array(registrant)), {
      decode: SchemaGetter.transform(dropBlankRegistrantEmails),
      encode: SchemaGetter.passthrough({ strict: false }),
    }),
  );

const requireRegistrantEmails = (requiredMessage: MessageKey) =>
  Schema.makeFilter(
    (shell: { readonly registrants: ReadonlyArray<Record<string, unknown>> }) => {
      const issues = shell.registrants.flatMap((registrant, index) => {
        const value = registrant['email'];
        return value === undefined || value === ''
          ? [
              {
                path: ['registrants', index, 'email'],
                issue: requiredMessage,
              },
            ]
          : [];
      });
      return issues.length === 0 ? undefined : issues;
    },
    { title: 'registrationShell.requireRegistrantEmails' },
  );

const registrantEmailRequiredMessage = (
  definition: FormDefinition,
): MessageKey => {
  for (const field of definition.fields) {
    if (field._tag === 'email' && field.name === 'email') {
      return field.requiredMessage;
    }
  }
  return MessageKey.make('registration.form.email.required');
};

const fillDefaultMode = (
  defaultMode: BillingMode,
  input: Record<string, unknown>,
): Record<string, unknown> => {
  const party = input['party'];
  if (party === null || typeof party !== 'object' || Array.isArray(party)) {
    return input;
  }
  const record = party as Record<string, unknown>;
  return record['_tag'] === undefined
    ? { ...input, party: { ...record, _tag: defaultMode } }
    : input;
};

const prepareMode = (defaultMode: BillingMode, input: unknown): unknown =>
  input !== null && typeof input === 'object' && !Array.isArray(input)
    ? fillDefaultMode(defaultMode, input as Record<string, unknown>)
    : input;

export const registrationShellDecoder = (
  definition: FormDefinition,
): ((
  payload: unknown,
) => Result.Result<RegistrationShellDecoded, Issue>) => {
  const registrant = definitionToSchema(definition);
  const groupRegistrant = definitionToSchema(
    withOptionalRegistrantEmail(definition),
  );
  const party = definition.party;
  const allowed = party
    ? (Object.keys(party.billingMode.options) as Array<BillingMode>)
    : [];
  const defaultMode = allowed[0];
  if (party === undefined || defaultMode === undefined) {
    const decoder = SchemaParser.decodeUnknownResult(
      Schema.Struct({
        registrants: Schema.mutable(Schema.Array(registrant)),
      }).check(nonEmptyParty as never),
    );
    return (payload) => decoder(payload);
  }

  const group =
    party.payer === undefined
      ? undefined
      : Schema.Struct({
          party: Schema.Struct({
            _tag: Schema.tag('group'),
            payer: payerCodec(party.payer),
          }),
          registrants: groupRegistrants(groupRegistrant),
        }).check(nonEmptyParty as never);

  const perRegistrant = Schema.Struct({
    party: Schema.Struct({
      _tag: Schema.tag('perRegistrant'),
      payer: Schema.optionalKey(Schema.Never),
    }),
    registrants: Schema.mutable(Schema.Array(registrant)),
  })
    .check(nonEmptyParty as never)
    .check(
      requireRegistrantEmails(
        registrantEmailRequiredMessage(definition),
      ) as never,
    );

  if (allowed.length === 1 && allowed[0] === 'group') {
    if (group === undefined) {
      throw new Error('Validated group billing mode requires payer fields');
    }
    const decoder = SchemaParser.decodeUnknownResult(group);
    return (payload) => decoder(prepareMode(defaultMode, payload));
  }
  if (allowed.length === 1 && allowed[0] === 'perRegistrant') {
    const decoder = SchemaParser.decodeUnknownResult(perRegistrant);
    return (payload) => decoder(prepareMode(defaultMode, payload));
  }
  if (group === undefined) {
    const decoder = SchemaParser.decodeUnknownResult(perRegistrant);
    return (payload) => decoder(prepareMode(defaultMode, payload));
  }
  const decoder = SchemaParser.decodeUnknownResult(
    Schema.Union([group, perRegistrant]),
  );
  return (payload) => decoder(prepareMode(defaultMode, payload));
};

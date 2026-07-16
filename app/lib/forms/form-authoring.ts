import { DateTime, Option, Result, Schema } from 'effect';

import { FormDefinition, type FieldKind } from './definition';

type TextDraft = { readonly en: string; readonly fr: string };
export type OptionDraft = TextDraft & { readonly value: string };

export type FieldDraft = {
  readonly _tag: FieldKind['_tag'];
  readonly name: string;
  readonly label: TextDraft;
  readonly placeholder?: TextDraft;
  readonly optional?: boolean;
  readonly multiline?: boolean;
  readonly requirePresent?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly requiredMessage?: string;
  readonly invalidMessage?: string;
  readonly presenceAnchor?: string;
  readonly options?: ReadonlyArray<OptionDraft>;
};

export type FieldLocation = {
  readonly area: 'common' | 'variant';
  readonly variant?: string;
  readonly groups: ReadonlyArray<string>;
};

export type RuleDraft =
  | {
      readonly _tag: 'requiredWhenEquals';
      readonly when: string;
      readonly values: ReadonlyArray<string>;
      readonly target: string;
      readonly message: string;
    }
  | {
      readonly _tag: 'activeWhenEquals';
      readonly predicate: 'literalEquals' | 'arrayIncludesAny' | 'checkboxChecked';
      readonly when: string;
      readonly values: ReadonlyArray<string>;
      readonly target: string;
    };

export type PricingRuleDraft =
  | {
      readonly _tag: 'choice' | 'multiChoice';
      readonly field: string;
      readonly prices: ReadonlyArray<{ readonly option: string; readonly amount: number }>;
    }
  | { readonly _tag: 'toggle'; readonly field: string; readonly amount: number }
  | {
      readonly _tag: 'quantity';
      readonly field: string;
      readonly unit: number;
      readonly max?: number;
    };

export type CommerceDraft = {
  readonly timeZone: string;
  readonly base: number;
  readonly registrationClosesAtLocal: string;
  readonly pricingRules: ReadonlyArray<PricingRuleDraft>;
  readonly windows: ReadonlyArray<{
    readonly id: string;
    readonly startsAtLocal: string;
    readonly endsAtLocal: string;
    readonly delta: number;
  }>;
  readonly party: {
    readonly intro?: TextDraft;
    readonly billingLabel: TextDraft;
    readonly requiredMessage: string;
    readonly group?: TextDraft;
    readonly perRegistrant?: TextDraft;
    readonly payer?: {
      readonly label: TextDraft;
      readonly nameLabel: TextDraft;
      readonly nameRequiredMessage: string;
      readonly emailLabel: TextDraft;
      readonly emailRequiredMessage: string;
      readonly emailInvalidMessage: string;
    };
  };
};

export type Command =
  | { readonly _tag: 'setCopy'; readonly title: TextDraft; readonly intro?: TextDraft }
  | {
      readonly _tag: 'setField';
      readonly location: FieldLocation;
      readonly index?: number;
      readonly field: FieldDraft;
    }
  | {
      readonly _tag: 'removeField';
      readonly location: FieldLocation;
      readonly index: number;
    }
  | {
      readonly _tag: 'moveField';
      readonly location: FieldLocation;
      readonly index: number;
      readonly direction: -1 | 1;
    }
  | {
      readonly _tag: 'setVariant';
      readonly discriminator: string;
      readonly requiredMessage: string;
      readonly options: ReadonlyArray<OptionDraft>;
    }
  | { readonly _tag: 'removeVariant' }
  | { readonly _tag: 'setRules'; readonly rules: ReadonlyArray<RuleDraft> }
  | { readonly _tag: 'setCommerce'; readonly commerce: CommerceDraft };

export type ApplyResult = Result.Result<FormDefinition, ReadonlyArray<string>>;

type EncodedField = Record<string, unknown> & {
  readonly _tag: string;
  readonly name: string;
  readonly fields?: ReadonlyArray<EncodedField>;
};
type EncodedVariant = {
  readonly discriminator: string;
  readonly requiredMessage: string;
  readonly options: ReadonlyArray<{
    readonly value: string;
    readonly label: TextDraft;
  }>;
  readonly variants: ReadonlyArray<{
    readonly value: string;
    readonly label: TextDraft;
    readonly fields: ReadonlyArray<EncodedField>;
  }>;
};
type EncodedDefinition = Record<string, unknown> & {
  readonly fields: ReadonlyArray<EncodedField>;
  readonly variant?: EncodedVariant;
};

const issues = (issue: unknown): ReadonlyArray<string> => [String(issue)];

const textOrUndefined = (text: TextDraft | undefined): TextDraft | undefined =>
  text === undefined || (text.en.trim() === '' && text.fr.trim() === '')
    ? undefined
    : { en: text.en.trim(), fr: text.fr.trim() };

const buildField = (
  draft: FieldDraft,
  previous?: EncodedField,
): EncodedField => {
  const chrome = {
    _tag: draft._tag,
    name: draft.name.trim(),
    label: { en: draft.label.en.trim(), fr: draft.label.fr.trim() },
    ...(textOrUndefined(draft.placeholder) === undefined
      ? {}
      : { placeholder: textOrUndefined(draft.placeholder) }),
  };
  switch (draft._tag) {
    case 'requiredText':
      return { ...chrome, ...(draft.optional === undefined ? {} : { optional: draft.optional }), ...(draft.multiline === undefined ? {} : { multiline: draft.multiline }), requiredMessage: draft.requiredMessage };
    case 'optionalText':
      return { ...chrome, ...(draft.multiline === undefined ? {} : { multiline: draft.multiline }), ...(draft.requirePresent === undefined ? {} : { requirePresent: draft.requirePresent }), invalidMessage: draft.invalidMessage };
    case 'email':
    case 'url':
      return { ...chrome, ...(draft.optional === undefined ? {} : { optional: draft.optional }), requiredMessage: draft.requiredMessage, invalidMessage: draft.invalidMessage };
    case 'number':
      return { ...chrome, ...(draft.optional === undefined ? {} : { optional: draft.optional }), ...(draft.min === undefined ? {} : { min: draft.min }), ...(draft.max === undefined ? {} : { max: draft.max }), requiredMessage: draft.requiredMessage, invalidMessage: draft.invalidMessage };
    case 'literal':
    case 'arrayOfLiteral':
      return { ...chrome, options: draft.options ?? [], requiredMessage: draft.requiredMessage };
    case 'checkboxBoolean':
      return { ...chrome, ...(draft.optional === undefined ? {} : { optional: draft.optional }), requiredMessage: draft.requiredMessage };
    case 'nestedGroup':
      return {
        _tag: 'nestedGroup',
        name: draft.name.trim(),
        label: chrome.label,
        ...(draft.optional === undefined ? {} : { optional: draft.optional }),
        ...(draft.presenceAnchor?.trim() ? { presenceAnchor: draft.presenceAnchor.trim() } : {}),
        fields: previous?._tag === 'nestedGroup' ? previous.fields ?? [] : [],
      };
  }
};

const modifyNested = (
  fields: ReadonlyArray<EncodedField>,
  groups: ReadonlyArray<string>,
  operation: (fields: ReadonlyArray<EncodedField>) => ReadonlyArray<EncodedField>,
): ReadonlyArray<EncodedField> => {
  const [group, ...rest] = groups;
  if (group === undefined) return operation(fields);
  return fields.map((field) =>
    field._tag === 'nestedGroup' && field.name === group
      ? { ...field, fields: modifyNested(field.fields ?? [], rest, operation) }
      : field,
  );
};

const modifyLocation = (
  definition: EncodedDefinition,
  location: FieldLocation,
  operation: (fields: ReadonlyArray<EncodedField>) => ReadonlyArray<EncodedField>,
): EncodedDefinition => {
  if (location.area === 'common') {
    return { ...definition, fields: modifyNested(definition.fields, location.groups, operation) };
  }
  return {
    ...definition,
    variant: definition.variant === undefined
      ? undefined
      : {
          ...definition.variant,
          variants: definition.variant.variants.map((variant) =>
            variant.value === location.variant
              ? { ...variant, fields: modifyNested(variant.fields as ReadonlyArray<EncodedField>, location.groups, operation) }
              : variant,
          ),
        },
  };
};

export const localConferenceInstant = (
  local: string,
  timeZone: string,
): Result.Result<string, string> => {
  const zoned = DateTime.makeZoned(local, {
    timeZone,
    adjustForTimeZone: true,
    disambiguation: 'reject',
  });
  return Option.isSome(zoned)
    ? Result.succeed(DateTime.formatIso(zoned.value))
    : Result.fail(`Invalid or ambiguous local time "${local}" in ${timeZone}`);
};

const rule = (draft: RuleDraft): unknown =>
  draft._tag === 'requiredWhenEquals'
    ? { _tag: draft._tag, when: draft.when, equals: draft.values, target: draft.target, message: draft.message }
    : {
        _tag: draft._tag,
        target: draft.target,
        predicate: {
          _tag: draft.predicate,
          when: draft.when,
          ...(draft.predicate === 'literalEquals'
            ? { equals: draft.values }
            : draft.predicate === 'arrayIncludesAny'
              ? { values: draft.values }
              : {}),
        },
      };

export const applyCommand = (
  definition: FormDefinition,
  command: Command,
): ApplyResult => {
  let encoded: EncodedDefinition = Schema.encodeSync(FormDefinition)(definition);
  switch (command._tag) {
    case 'setCopy':
      {
        const { intro: _intro, ...withoutIntro } = encoded;
        const intro = textOrUndefined(command.intro);
        encoded = { ...withoutIntro, title: command.title, ...(intro === undefined ? {} : { intro }) };
      }
      break;
    case 'setField':
      encoded = modifyLocation(encoded, command.location, (fields) => {
        const next = [...fields];
        if (command.index === undefined) next.push(buildField(command.field));
        else next[command.index] = buildField(command.field, next[command.index]);
        return next;
      });
      break;
    case 'removeField':
      encoded = modifyLocation(encoded, command.location, (fields) => fields.filter((_, index) => index !== command.index));
      break;
    case 'moveField':
      encoded = modifyLocation(encoded, command.location, (fields) => {
        const target = command.index + command.direction;
        if (target < 0 || target >= fields.length) return fields;
        const next = [...fields];
        [next[command.index], next[target]] = [next[target]!, next[command.index]!];
        return next;
      });
      break;
    case 'setVariant': {
      const existing = new Map(
        (encoded.variant?.variants ?? []).map((variant) => [variant.value, variant.fields]),
      );
      encoded = {
        ...encoded,
        variant: {
          discriminator: command.discriminator,
          requiredMessage: command.requiredMessage,
          options: command.options.map((option) => ({
            value: option.value,
            label: { en: option.en, fr: option.fr },
          })),
          variants: command.options.map((option) => ({
            value: option.value,
            label: { en: option.en, fr: option.fr },
            fields: existing.get(option.value) ?? [],
          })),
        },
      };
      break;
    }
    case 'removeVariant':
      {
        const { variant: _variant, ...withoutVariant } = encoded;
        encoded = withoutVariant;
      }
      break;
    case 'setRules':
      encoded = { ...encoded, rules: command.rules.map(rule) };
      break;
    case 'setCommerce': {
      const closes = localConferenceInstant(
        command.commerce.registrationClosesAtLocal,
        command.commerce.timeZone,
      );
      if (Result.isFailure(closes)) return Result.fail([closes.failure]);
      const windows: unknown[] = [];
      for (const window of command.commerce.windows) {
        const starts = localConferenceInstant(window.startsAtLocal, command.commerce.timeZone);
        const ends = localConferenceInstant(window.endsAtLocal, command.commerce.timeZone);
        if (Result.isFailure(starts) || Result.isFailure(ends)) {
          return Result.fail([
            ...(Result.isFailure(starts) ? [starts.failure] : []),
            ...(Result.isFailure(ends) ? [ends.failure] : []),
          ]);
        }
        windows.push({ id: window.id, startsAt: starts.success, endsAt: ends.success, delta: window.delta });
      }
      encoded = {
        ...encoded,
        pricing: {
          currency: 'cad',
          base: command.commerce.base,
          registrationClosesAt: closes.success,
          rules: command.commerce.pricingRules,
          windows,
        },
        party: {
          ...(textOrUndefined(command.commerce.party.intro) === undefined
            ? {}
            : { intro: textOrUndefined(command.commerce.party.intro) }),
          billingMode: {
            label: command.commerce.party.billingLabel,
            requiredMessage: command.commerce.party.requiredMessage,
            options: {
              ...(command.commerce.party.group === undefined
                ? {}
                : { group: command.commerce.party.group }),
              ...(command.commerce.party.perRegistrant === undefined
                ? {}
                : { perRegistrant: command.commerce.party.perRegistrant }),
            },
          },
          ...(command.commerce.party.payer === undefined
            ? {}
            : {
                payer: {
                  label: command.commerce.party.payer.label,
                  nameField: {
                    label: command.commerce.party.payer.nameLabel,
                    requiredMessage:
                      command.commerce.party.payer.nameRequiredMessage,
                  },
                  emailField: {
                    label: command.commerce.party.payer.emailLabel,
                    requiredMessage:
                      command.commerce.party.payer.emailRequiredMessage,
                    invalidMessage:
                      command.commerce.party.payer.emailInvalidMessage,
                  },
                },
              }),
        },
      };
      break;
    }
  }
  const decoded = Schema.decodeUnknownResult(FormDefinition)(encoded);
  return Result.isSuccess(decoded)
    ? Result.succeed(decoded.success)
    : Result.fail(issues(decoded.failure));
};

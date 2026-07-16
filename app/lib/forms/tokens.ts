import { Schema } from 'effect';

import { root } from '../localization/translations';

/** Leaf schemas shared by Form definitions and their commerce dimensions. */

const TRANSLATION_KEYS: ReadonlySet<string> = new Set(Object.keys(root.en));

const messageKeyFilter = Schema.makeFilter<string>(
  (key) =>
    TRANSLATION_KEYS.has(key)
      ? undefined
      : `MessageKey must be a known TranslationKey; "${key}" is not in translations`,
  { title: 'MessageKey' },
);

export const MessageKey = Schema.NonEmptyString.check(messageKeyFilter).pipe(
  Schema.brand('MessageKey'),
);
export type MessageKey = typeof MessageKey.Type;

export const FieldName = Schema.NonEmptyString.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/, { title: 'FieldName' }),
).pipe(Schema.brand('FieldName'));
export type FieldName = typeof FieldName.Type;

export const OptionValue = Schema.NonEmptyString.check(
  Schema.isPattern(/^[A-Za-z0-9_-]+$/, { title: 'OptionValue' }),
).pipe(Schema.brand('OptionValue'));
export type OptionValue = typeof OptionValue.Type;

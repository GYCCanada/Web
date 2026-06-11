import { expect } from 'bun:test';
import { Schema } from 'effect';

import { root } from '~/lib/localization/translations';

import { formatSchemaResult, parseSchema } from './form-schema';

/**
 * Form-schema test guards shared by the contact/volunteer/registration suites
 * (naming follows `storage.test-helper.ts`). Every validation message a form
 * schema emits must be a real `en` translation key: `FieldErrors` renders each
 * message through `translate()`, so a default English Schema message — or any
 * key absent from `translations.ts` — renders blank. These helpers assert that
 * no decode path can ship such a message.
 */

/** True when `key` is a real `en` translation key (`translate()` will resolve it). */
export const isTranslationKey = (key: string): boolean => key in root.en;

/**
 * The client-side Standard Schema issue messages for a payload — the same path
 * `useForm` drives. Each must be a real translation key for the same reason the
 * server path must.
 */
export const clientMessages = <A, I>(
  schema: Schema.Codec<A, I, never, never>,
  payload: unknown,
): string[] => {
  const std = Schema.toStandardSchemaV1(schema);
  const result = std['~standard'].validate(payload) as {
    issues?: ReadonlyArray<{ message: string }>;
  };
  return (result.issues ?? []).map((i) => i.message);
};

/**
 * Assert that decoding each payload yields only real translation keys — across
 * both the form-level errors and every flattened field error. The assertion
 * shape `{ message, isKey }` is deliberate: a failure prints the offending
 * message verbatim, so a regression names the exact non-key it emitted.
 */
export const expectOnlyTranslationKeys = <A, I>(
  schema: Schema.Codec<A, I, never, never>,
  payloads: unknown[],
): void => {
  for (const payload of payloads) {
    const formatted = formatSchemaResult(parseSchema(schema, payload));
    const messages = [
      ...(formatted?.formErrors ?? []),
      ...Object.values(formatted?.fieldErrors ?? {}).flat(),
    ];
    for (const message of messages) {
      expect({ message, isKey: isTranslationKey(message) }).toEqual({
        message,
        isKey: true,
      });
    }
  }
};

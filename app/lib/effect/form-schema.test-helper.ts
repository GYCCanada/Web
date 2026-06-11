import { formatPath } from '@conform-to/dom/future';
import { expect } from 'bun:test';
import { Schema } from 'effect';
import type { StandardSchemaV1 } from '@standard-schema/spec';

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
 * The client-side Standard Schema issues for a payload — the same path `useForm`
 * drives — paired with the **conform field name** each issue's path serializes
 * to. `useForm` attaches an issue to the field named by `formatPath(issue.path)`,
 * so a key that resolves to the wrong field name renders nowhere; asserting the
 * name (not just the message) catches that. Object path segments (`{ key }`) are
 * unwrapped and numbers stay numeric so `formatPath` renders `[n]` indices,
 * matching `issuePathToName` in `form-schema.ts`.
 */
const clientIssues = <A, I>(
  schema: Schema.Codec<A, I, never, never>,
  payload: unknown,
): Array<{ name: string; message: string }> => {
  const std = Schema.toStandardSchemaV1(schema);
  const result = std['~standard'].validate(payload) as {
    issues?: ReadonlyArray<{
      message: string;
      path?: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment>;
    }>;
  };
  return (result.issues ?? []).map((issue) => {
    const segments: Array<string | number> = [];
    for (const segment of issue.path ?? []) {
      const value =
        typeof segment === 'object' && segment !== null && 'key' in segment
          ? segment.key
          : segment;
      if (typeof value === 'string' || typeof value === 'number') {
        segments.push(value);
      }
    }
    return { name: formatPath(segments), message: issue.message };
  });
};

/**
 * The client-side Standard Schema issue messages for a payload — the same path
 * `useForm` drives. Each must be a real translation key for the same reason the
 * server path must.
 */
export const clientMessages = <A, I>(
  schema: Schema.Codec<A, I, never, never>,
  payload: unknown,
): string[] => clientIssues(schema, payload).map((i) => i.message);

/**
 * Assert that decoding each payload yields only real translation keys — across
 * **both** validation paths: the server path (`parseSchema` +
 * `formatSchemaResult`, form- and field-level errors) and the client Standard
 * Schema path (`toStandardSchemaV1`, the same `useForm` drives). A key absent
 * from `translations.ts` renders blank on either, so both must be guarded. The
 * assertion shape `{ message, isKey }` is deliberate: a failure prints the
 * offending message verbatim, so a regression names the exact non-key it
 * emitted.
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
      ...clientMessages(schema, payload),
    ];
    for (const message of messages) {
      expect({ message, isKey: isTranslationKey(message) }).toEqual({
        message,
        isKey: true,
      });
    }
  }
};

/**
 * Assert a payload surfaces exactly `keys` at conform field `name` on **both**
 * paths — server (`formatSchemaResult` field errors) and client
 * (`toStandardSchemaV1` issue paths, serialized to conform names). The
 * field-name assertion is the point: a real translation key that lands at the
 * wrong field name (e.g. on the array element `registrants[0]` instead of the
 * `registrants[0].type` field the UI renders) never displays, so a name
 * mismatch must fail the test. `keys` must also all be real translation keys.
 */
export const expectFieldError = <A, I>(
  schema: Schema.Codec<A, I, never, never>,
  payload: unknown,
  name: string,
  keys: string[],
): void => {
  for (const key of keys) {
    expect({ key, isKey: isTranslationKey(key) }).toEqual({ key, isKey: true });
  }

  const formatted = formatSchemaResult(parseSchema(schema, payload));
  expect({ path: 'server', name, errors: formatted?.fieldErrors?.[name] }).toEqual(
    { path: 'server', name, errors: keys },
  );

  const clientErrors = clientIssues(schema, payload)
    .filter((issue) => issue.name === name)
    .map((issue) => issue.message);
  expect({ path: 'client', name, errors: clientErrors }).toEqual({
    path: 'client',
    name,
    errors: keys,
  });
};

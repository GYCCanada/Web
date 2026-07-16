import { Effect, Schema } from 'effect';

import { FormDefinition, type FormId } from './definition';
import {
  FormDefinitionVersionId,
  type FormDefinitionVersionId as FormDefinitionVersionIdType,
} from './submission-command';

const decodeDefinition = Schema.decodeUnknownEffect(FormDefinition);
const encodeDefinitionJson = Schema.encodeUnknownEffect(
  Schema.fromJsonString(FormDefinition),
);

export const sha256 = Effect.fn('FormVersion.sha256')(function* (value: string) {
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
});

/** Canonicalize and content-address a definition exactly as the Forms write boundary does. */
export const prepareDefinitionVersion = Effect.fn(
  'FormVersion.prepareDefinitionVersion',
)(function* (form: FormId, input: unknown) {
  const definition = yield* decodeDefinition(input);
  const definitionJson = yield* encodeDefinitionJson(definition).pipe(
    Effect.orDie,
  );
  const version = FormDefinitionVersionId.make(
    `sha256:${yield* sha256(`${form}\0${definitionJson}`)}`,
  );
  return { definition, definitionJson, version };
});

/** Hash the exact immutable-version plus canonical-payload command representation. */
export const submissionCommandHash = (
  version: FormDefinitionVersionIdType,
  payloadJson: readonly string[],
): Effect.Effect<string> => sha256(JSON.stringify([version, ...payloadJson]));

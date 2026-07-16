import { nanoid } from 'nanoid';
import { Schema } from 'effect';

import type { FormResult } from '../effect/form';

export const FormDefinitionVersionId = Schema.String.check(
  Schema.isPattern(/^sha256:[0-9a-f]{64}$/),
).pipe(Schema.brand('FormDefinitionVersionId'));
export type FormDefinitionVersionId = typeof FormDefinitionVersionId.Type;

export const IdempotencyToken = Schema.NonEmptyString.check(
  Schema.isMaxLength(200),
).pipe(Schema.brand('IdempotencyToken'));
export type IdempotencyToken = typeof IdempotencyToken.Type;

export const FORM_VERSION_FIELD = '__formDefinitionVersion';
export const IDEMPOTENCY_TOKEN_FIELD = '__idempotencyToken';

export interface SubmissionCommandFields {
  readonly definitionVersion: FormDefinitionVersionId;
  readonly idempotencyToken: IdempotencyToken;
}

/** Mint the identity of one rendered attempt; retries preserve these hidden values. */
export const newSubmissionCommandFields = (
  definitionVersion: FormDefinitionVersionId,
): SubmissionCommandFields => ({
  definitionVersion,
  idempotencyToken: IdempotencyToken.make(nanoid()),
});

/** Apply the action's explicit attempt-lifecycle decision to a revalidated loader command. */
export const resolveSubmissionCommandFields = (
  fallback: SubmissionCommandFields,
  actionCommand?: FormResult['command'],
): SubmissionCommandFields => {
  if (actionCommand === undefined) return fallback;

  switch (actionCommand.disposition) {
    case 'refreshDefinition':
    case 'rotateToken':
      return fallback;
    case 'preserve': {
      const definitionVersion =
        actionCommand.preserved[FORM_VERSION_FIELD];
      const idempotencyToken =
        actionCommand.preserved[IDEMPOTENCY_TOKEN_FIELD];
      return Schema.is(FormDefinitionVersionId)(definitionVersion) &&
        Schema.is(IdempotencyToken)(idempotencyToken)
        ? { definitionVersion, idempotencyToken }
        : fallback;
    }
  }
};

/** Bind a POST to the definition it rendered and to one explicit retry identity. */
export function SubmissionCommandInputs({
  definitionVersion,
  idempotencyToken,
}: SubmissionCommandFields) {
  return (
    <>
      <input
        type="hidden"
        name={FORM_VERSION_FIELD}
        value={definitionVersion}
      />
      <input
        type="hidden"
        name={IDEMPOTENCY_TOKEN_FIELD}
        value={idempotencyToken}
      />
    </>
  );
}

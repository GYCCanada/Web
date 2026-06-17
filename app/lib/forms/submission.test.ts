import { describe, expect, test } from 'bun:test';
import { Result, Schema } from 'effect';

import { FormDefinition as FormDefinitionSchema } from './definition';
import type { FormDefinition } from './definition';
import {
  newSubmissionId,
  SubmissionEnvelope,
  submissionSchema,
} from './submission';

/**
 * Branch 7.1 — the persisted `Submission` schema (CONTEXT §Submission, settled #8).
 *
 * These tests pin the two load-bearing guarantees the persistence service
 * (Branch 7.2) and the future first-party registrar build on (`prove-it-works`):
 *
 *   - the `payload` shape is DERIVED from the form's `FormDefinition`, not
 *     re-declared (`derive-dont-sync`): the same off-list / missing-field
 *     submission the generic decoder rejects is rejected inside a `Submission`,
 *     and a valid decoded form round-trips losslessly through
 *     `encode → JSON → decode` (the on-bucket `submissions/<form>/<id>.json`
 *     shape);
 *   - the envelope is watertight (`make-impossible-states-unrepresentable`): a
 *     bad `id`, an off-list `form`, or a non-calendar `submittedAt` is a hard
 *     decode error, and the metadata decodes through `SubmissionEnvelope` without
 *     the form's field graph (`small-interface-deep-implementation`).
 */

const text = (en: string, fr: string) => ({ en, fr });

/** Decode a raw JSON definition through the schema (as `Content.getForm` would). */
const asDefinition = (json: unknown): FormDefinition =>
  Schema.decodeUnknownSync(FormDefinitionSchema)(json);

/**
 * A two-field contact-shaped definition: a required name + a required email. The
 * derived `Submission` payload must accept exactly what `decodeForm` accepts for
 * this definition.
 */
const contactDef = asDefinition({
  title: text('Contact', 'Contact'),
  fields: [
    {
      _tag: 'requiredText',
      name: 'name',
      label: text('Name', 'Nom'),
      requiredMessage: 'contact.form.name.required',
    },
    {
      _tag: 'email',
      name: 'email',
      label: text('Email', 'Courriel'),
      requiredMessage: 'contact.form.email.required',
      invalidMessage: 'contact.form.email.error',
    },
  ],
});

/** A valid stored submission for {@link contactDef}, in its encoded (JSON) shape. */
const validContactSubmission = {
  id: newSubmissionId(),
  form: 'contact',
  submittedAt: '2026-06-17',
  payload: { name: 'Ada', email: 'ada@example.com' },
};

describe('submissionSchema — payload derived from the FormDefinition', () => {
  const schema = submissionSchema(contactDef);
  const decode = Schema.decodeUnknownResult(schema);

  test('a valid submission decodes, envelope + payload intact', () => {
    const result = decode(validContactSubmission);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.form).toBe('contact');
      expect(String(result.success.submittedAt)).toBe('2026-06-17');
      expect(result.success.payload['name']).toBe('Ada');
      expect(result.success.payload['email']).toBe('ada@example.com');
    }
  });

  test('round-trips losslessly through encode → JSON → decode', () => {
    const codec = Schema.fromJsonString(schema);
    const roundTripped = Schema.encodeUnknownSync(codec)(
      Schema.decodeUnknownSync(schema)(validContactSubmission),
    );
    const back = Schema.decodeUnknownSync(codec)(roundTripped);
    expect(back).toEqual(Schema.decodeUnknownSync(schema)(validContactSubmission));
  });

  test('a payload the form decoder rejects is rejected inside the Submission', () => {
    // Missing the required `email` — the SAME failure `decodeForm` reports, now
    // surfaced through the Submission's derived payload codec (`derive-dont-sync`).
    const result = decode({
      ...validContactSubmission,
      payload: { name: 'Ada' },
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  test('an invalid email in the payload is rejected by the derived codec', () => {
    const result = decode({
      ...validContactSubmission,
      payload: { name: 'Ada', email: 'not-an-email' },
    });
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe('submissionSchema — the payload tracks a different definition', () => {
  /** A literal-field definition: the payload is a closed choice, not free text. */
  const choiceDef = asDefinition({
    title: text('F', 'F'),
    fields: [
      {
        _tag: 'literal',
        name: 'kind',
        label: text('Kind', 'Type'),
        options: [
          { value: 'a', label: text('A', 'A') },
          { value: 'b', label: text('B', 'B') },
        ],
        requiredMessage: 'contact.form.name.required',
      },
    ],
  });
  const decode = Schema.decodeUnknownResult(submissionSchema(choiceDef));

  test('an on-list choice decodes', () => {
    const result = decode({
      id: newSubmissionId(),
      form: 'volunteer',
      submittedAt: '2026-01-01',
      payload: { kind: 'a' },
    });
    expect(Result.isSuccess(result)).toBe(true);
  });

  test('an off-list choice is a hard decode error (derived from the definition)', () => {
    const result = decode({
      id: newSubmissionId(),
      form: 'volunteer',
      submittedAt: '2026-01-01',
      payload: { kind: 'c' },
    });
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe('Submission envelope — make-impossible-states-unrepresentable', () => {
  const decode = Schema.decodeUnknownResult(submissionSchema(contactDef));

  test('an off-list `form` is rejected', () => {
    const result = decode({
      ...validContactSubmission,
      form: 'newsletter',
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  test('a non-nanoid `id` is rejected', () => {
    const result = decode({ ...validContactSubmission, id: 'too-short' });
    expect(Result.isFailure(result)).toBe(true);
  });

  test('a non-calendar `submittedAt` is rejected', () => {
    for (const submittedAt of ['2026-02-31', 'today', '2026-13-01']) {
      const result = decode({ ...validContactSubmission, submittedAt });
      expect(Result.isFailure(result)).toBe(true);
    }
  });
});

describe('SubmissionEnvelope — metadata without the field graph', () => {
  const decode = Schema.decodeUnknownResult(SubmissionEnvelope);

  test('decodes the metadata regardless of the form payload', () => {
    // A listing / the future registrar's index reads id+form+submittedAt without
    // knowing (or carrying) the form's field graph (small-interface-deep-impl).
    const result = decode(validContactSubmission);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.form).toBe('contact');
      expect(result.success.id).toBe(validContactSubmission.id);
    }
  });

  test('newSubmissionId mints a schema-valid id', () => {
    const result = decode({
      id: newSubmissionId(),
      form: 'registration',
      submittedAt: '2026-06-17',
    });
    expect(Result.isSuccess(result)).toBe(true);
  });
});

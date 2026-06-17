import { Schema } from 'effect';

import { IsoDate, ListItemId, newListItemId } from '../content/schema';
import { FormId } from '../content/pages/registry';

import { definitionToSchema } from './decode';
import type { FormDefinition } from './definition';

/**
 * The persisted `Submission` schema (CONTEXT §Submission, settled #8;
 * registration-launch Branch 7.1). A `Submission` is the durable record of one
 * completed form (a registration, a contact message, a volunteer signup), stored
 * as its own bucket object (`submissions/<form>/<id>.json`) at submit time. It is
 * the source of truth — the planned future first-party registrar reads the
 * registration Submission log; the email is a notification OF this record, never
 * the record itself (CONTEXT §Submission:48).
 *
 * This sub-commit (7.1) lands ONLY the schema (+ its round-trip / derivation
 * tests). The persistence service (`Submissions.persist`, persist-only) lands in
 * 7.2; wiring persist-then-notify into the generic action skeleton lands in 7.3.
 *
 * Modelling principles (`~/.brain/principles`):
 *
 *   - `derive-dont-sync`: the `payload`'s shape is NOT re-declared — it IS the
 *     decoded form, compiled from the very same `FormDefinition` the generic
 *     decoder (`decodeForm`, Branch 6.2) validates submissions against. The
 *     `Submission` schema is therefore a FACTORY parameterized by the form's
 *     `FormDefinition`: `submissionSchema(definition)` embeds
 *     `definitionToSchema(definition)` as its `payload` codec. Editing
 *     `forms/<form>.json` changes what a `Submission`'s payload may hold with no
 *     change to this module — the future registrar's read contract is exactly the
 *     form's decoded type (ADR 0007 consequence). Re-declaring a per-form payload
 *     struct here would be a parallel copy that could silently drift from the
 *     definition.
 *
 *   - `make-impossible-states-unrepresentable`: the `form` slot is the CLOSED
 *     `FormId` literal (`contact` | `volunteer` | `registration`) — a submission
 *     can only ever name a form that exists; `id` is a branded `ListItemId`
 *     (nanoid), `submittedAt` a branded `IsoDate` (a real calendar date). The
 *     envelope is uniform across forms; only the `payload` varies, and it varies
 *     by derivation, not by a hand-written union.
 *
 *   - `small-interface-deep-implementation`: the module exposes one factory
 *     (`submissionSchema`) + the form-independent envelope field set
 *     (`submissionEnvelope`) so a consumer that only needs to read the metadata
 *     (id / form / submittedAt) — a listing, the future registrar's index — can
 *     decode against the envelope without knowing the form's field graph. The
 *     deep part (compiling the definition into the payload codec) is hidden
 *     behind the factory.
 *
 * The encoded form of a `submissionSchema(definition)` IS the JSON stored at
 * `submissions/<form>/<id>.json`, so a `Submission` round-trips losslessly through
 * `encode → JSON → decode` (proven in `submission.test.ts`).
 */

/**
 * The form-independent envelope every `Submission` carries, regardless of which
 * form produced it: a fresh `ListItemId` (the `<id>` segment of its bucket key),
 * the closed `FormId` it belongs to, and the `IsoDate` it was submitted on. The
 * per-form `payload` is layered on by {@link submissionSchema}; this struct is the
 * metadata a listing / the future registrar's index reads without the field graph.
 */
export const submissionEnvelope = {
  id: ListItemId,
  form: FormId,
  submittedAt: IsoDate,
} as const;

/** The decoded envelope — a `Submission`'s metadata without its form payload. */
export const SubmissionEnvelope = Schema.Struct(submissionEnvelope);
export type SubmissionEnvelope = typeof SubmissionEnvelope.Type;

/**
 * Build the `Submission` schema for one form FROM its `FormDefinition`
 * (`derive-dont-sync`). The `payload` codec is `definitionToSchema(definition)` —
 * the SAME compiled codec the generic decoder validates submissions with — so the
 * stored payload's shape is the form's decoded type by construction, never a
 * parallel declaration. The result is the codec that decodes/encodes a stored
 * `submissions/<form>/<id>.json` object; its `Type` is the envelope plus the
 * derived `DecodedForm` payload (no re-declared per-form struct).
 */
export const submissionSchema = (definition: FormDefinition) =>
  Schema.Struct({
    ...submissionEnvelope,
    payload: definitionToSchema(definition),
  });

/**
 * The decoded `Submission` for a given form: the envelope plus the form's decoded
 * `payload`. Derived from {@link submissionSchema} so the payload type is the
 * `DecodedForm` the generic decoder produces — exactly what `decodeForm` returns
 * on a valid submission — never a re-declaration that could drift.
 */
export type Submission = ReturnType<typeof submissionSchema>['Type'];

/**
 * The encoded `Submission` — the JSON shape stored at
 * `submissions/<form>/<id>.json` (brands erased to plain strings; the payload is
 * the form's encoded submission shape). Derived from the same factory.
 */
export type SubmissionEncoded = ReturnType<typeof submissionSchema>['Encoded'];

/** Mint a fresh, schema-valid `Submission` id (a nanoid `ListItemId`). */
export const newSubmissionId = (): ListItemId => newListItemId();

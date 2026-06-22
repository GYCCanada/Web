export * as Submissions from './submissions.server';

import { Clock, Context, DateTime, Effect, Layer, Schema } from 'effect';

import { Content } from '../content.server';
import { type FormId, orderKey, submissionKey } from '../content/pages/registry';
import {
  deterministicListItemId,
  IsoDate,
  newListItemId,
} from '../content/schema';
import { Storage, type StorageError } from '../storage.server';

import type { DecodedForm } from './decode';
import { RegistrationOrder } from './order';
import { submissionSchema, type Submission } from './submission';

/**
 * The persisted-`Submission` write service (CONTEXT §Submission, settled #8;
 * registration-launch Branch 7.2). `persist` is the durable half of the
 * submission pipeline — it encodes a decoded form to its `Submission` envelope and
 * `Storage.put`s it at `submissions/<form>/<id>.json`, returning the stored record.
 *
 * Principles (`~/.brain/principles`):
 *
 *   - `small-interface-deep-implementation`: the service exposes exactly ONE
 *     operation — `persist`. It is persistence ONLY: no mailer, no notification.
 *     The bucket write is the durable source of truth; the email is a notification
 *     OF the stored record (CONTEXT §Submission:48), wired as a SEPARATE step in
 *     the generic form action skeleton (Branch 7.3). Splitting `persist` (this
 *     module) from `notify` (the action's terminal step) is what makes
 *     "a notify failure provably cannot lose the record" a real, testable property:
 *     `persist` returns the stored `Submission` BEFORE any notification runs, so a
 *     downstream mailer failure still leaves `submissions/<form>/<id>.json` on the
 *     bucket.
 *
 *   - `derive-dont-sync`: the stored object's payload codec is
 *     `submissionSchema(definition)` — the SAME schema derived from the form's
 *     `FormDefinition` the generic decoder (`decodeForm`, Branch 6.2) validates
 *     submissions against, never a re-declared per-form struct. `persist` reads the
 *     definition through `Content.getForm(form)` (Branch 5.3's CMS-editable read
 *     path), so editing `forms/<form>.json` changes what a stored `Submission` may
 *     hold with no change to this module. The envelope id / storage key are
 *     derived too: `newListItemId()` mints the `<id>` segment, `submissionKey`
 *     derives the bucket key from the closed `FormId` + that id — never hand-typed.
 *
 *   - `make-impossible-states-unrepresentable`: `form` is the closed `FormId`
 *     literal, `submittedAt` is decoded through the branded `IsoDate` (a real
 *     calendar date), `id` is a branded `ListItemId` (nanoid). A `persist` whose
 *     `decoded` payload does not satisfy the form's derived codec is a hard encode
 *     failure (it dies — a decoded form ALWAYS re-encodes, so a failure here is a
 *     bug upstream, not a user error), never a silently half-written object.
 *
 * The service captures `Content` + `Storage` at layer construction (opencode's
 * module-level `export const layer` / `defaultLayer`, vs a `static` member). The
 * only user-facing failure is the bucket write (`StorageError`); a degraded
 * (bucket-less) `Storage` fails the put loudly rather than silently dropping the
 * record (`Storage.layerOptional`'s disabled-write path), which is correct — losing
 * a submission must never look like success.
 */

/** Format a UTC millisecond instant as a `YYYY-MM-DD` calendar-date string. */
const isoDateString = (millis: number): string =>
  DateTime.formatIso(DateTime.makeUnsafe(millis)).slice(0, 10);

/** Decode a `YYYY-MM-DD` string through the branded, real-calendar `IsoDate`. */
const decodeIsoDate = Schema.decodeUnknownEffect(IsoDate);

export class Service extends Context.Service<
  Service,
  {
    /**
     * Persist one decoded form as a durable `Submission` object and return the
     * stored record. Stamps `submittedAt` with the current calendar date, encodes
     * the envelope + the definition-derived payload to JSON, and `Storage.put`s it
     * at `submissions/<form>/<id>.json`. Persistence ONLY — the notification is a
     * separate step (Branch 7.3); `persist` returning the record before any
     * notification runs is what makes the record durable across a notify failure.
     *
     * `idempotencyKey` (optional) makes the write retry-safe: when supplied, the
     * record's `id` is **derived deterministically** from it (`deterministicListItemId`)
     * instead of a fresh random nanoid, so persisting the same logical record twice
     * (e.g. a user retrying a partially-failed multi-registrant registration) writes
     * to the SAME bucket key and overwrites rather than minting a duplicate object.
     * Omit it for single-record submissions (contact/volunteer) where each submit is
     * a genuinely new record. The caller owns what makes a record "the same"
     * (registration scopes by per-request fingerprint + registrant index).
     */
    readonly persist: (
      form: FormId,
      decoded: DecodedForm,
      idempotencyKey?: string,
    ) => Effect.Effect<Submission, StorageError>;
    /**
     * Persist one frozen `RegistrationOrder` as a durable bucket object at
     * `submissions/<form>/orders/<orderId>.json` (`orderKey`) and return it
     * (registrar plan Decision 2 / Decision 7 step 3). The order's `amount` +
     * `receiptEmail` are already frozen by the caller at create-intent time; this
     * is persistence ONLY. The write is content-addressed by the order's own
     * `orderId` (the request fingerprint in `group`), so a verbatim checkout retry
     * OVERWRITES the same object in place rather than minting a duplicate — the
     * same idempotency discipline `persist` gives a registrant record. The webhook
     * (C8) reads this record back to mark it `paid`.
     */
    readonly persistOrder: (
      form: FormId,
      order: RegistrationOrder,
    ) => Effect.Effect<RegistrationOrder, StorageError>;
  }
>()('gycc/lib/forms/submissions.server/Service') {}

/**
 * The `Submissions` layer, reading the form definition through `Content` and
 * writing through `Storage` (opencode's module-level `export const layer`,
 * `packages/core/src/git.ts:79`). Leaves `Content` + `Storage` open so the app
 * runtime and tests can supply different layers; `defaultLayer` pre-provides them.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const content = yield* Content.Service;
    const storage = yield* Storage.Service;

    const persist = Effect.fn('Submissions.persist')(function* (
      form: FormId,
      decoded: DecodedForm,
      idempotencyKey?: string,
    ) {
      // The form's CMS-editable definition (Branch 5.3) — the payload codec is
      // derived from it, never re-declared (`derive-dont-sync`).
      const definition = yield* content.getForm(form);
      const schema = submissionSchema(definition);

      const now = yield* Clock.currentTimeMillis;
      // With an idempotency key the id is content-addressed (a retry of the same
      // logical record re-derives the same id → the same key → `put` overwrites);
      // without one, a fresh random id per submit (the default for single-record
      // forms). `idempotencyKey` is namespaced by `form` so the same key under two
      // forms cannot collide onto one object.
      const id =
        idempotencyKey === undefined
          ? newListItemId()
          : deterministicListItemId(`${form}:${idempotencyKey}`);
      // `submittedAt` round-trips through the branded `IsoDate`: a clock-derived
      // `YYYY-MM-DD` is always a real calendar date, so a decode failure here is a
      // bug, not a user error — it dies rather than masquerading as a failure.
      const submittedAt = yield* decodeIsoDate(isoDateString(now)).pipe(
        Effect.orDie,
      );

      const submission: Submission = { id, form, submittedAt, payload: decoded };

      // A decoded `Submission` ALWAYS re-encodes through its derived codec; a
      // failure here is an upstream bug (a `decoded` that never came from
      // `decodeForm` for this `form`), so it dies rather than masquerading as a
      // `StorageError`. The encode is the validation: it runs the payload codec's
      // encode side, so a structurally-wrong payload cannot be silently stored.
      const json = yield* Schema.encodeUnknownEffect(
        Schema.fromJsonString(schema),
      )(submission).pipe(Effect.orDie);

      yield* storage.put(submissionKey(form, id), json, 'application/json');

      return submission;
    });

    const persistOrder = Effect.fn('Submissions.persistOrder')(function* (
      form: FormId,
      order: RegistrationOrder,
    ) {
      // A frozen order ALWAYS re-encodes through its own (form-independent) codec;
      // a failure here is an upstream bug (a hand-built order that never satisfied
      // `RegistrationOrder`), so it dies rather than masquerading as a
      // `StorageError`. The encode is the validation, exactly as `persist`'s is.
      const json = yield* Schema.encodeUnknownEffect(
        Schema.fromJsonString(RegistrationOrder),
      )(order).pipe(Effect.orDie);

      yield* storage.put(
        orderKey(form, order.orderId),
        json,
        'application/json',
      );

      return order;
    });

    return Service.of({ persist, persistOrder });
  }),
);

/**
 * The self-contained `Submissions` (opencode's `export const defaultLayer`),
 * with its `Content` + `Storage` dependencies pre-provided as their never-fails-
 * to-build default layers. The standalone consumers that wire `Submissions`
 * without separately composing `Content` / `Storage` provide this directly.
 */
export const defaultLayer = layer.pipe(
  Layer.provide(Content.defaultLayer),
  Layer.provide(Storage.defaultLayer),
);

export * as Submissions from './submissions.server';

import { Clock, Context, DateTime, Effect, Layer, Schema } from 'effect';

import { Content } from '../content.server';
import { type FormId, orderKey, submissionKey } from '../content/pages/registry';
import {
  deterministicListItemId,
  IsoDate,
  newListItemId,
} from '../content/schema';
import { type NotFound, Storage, type StorageError } from '../storage.server';

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
    /**
     * Read one frozen order back off the bucket and decode it
     * (`submissions/<form>/orders/<orderId>.json`). The webhook (C8) re-reads the
     * order to verify the charged amount against the order's FROZEN `amount`
     * BEFORE marking it paid (Decision 7 — the amount-check is the caller's
     * concern, not a side effect of the flip). Fails `NotFound` when no such order
     * exists (an event for an order that has not landed), `StorageError` on a
     * bucket fault. A stored order ALWAYS decodes (written from this same schema),
     * so a decode failure is bucket corruption and dies, never a soft failure.
     */
    readonly getOrder: (
      form: FormId,
      orderId: string,
    ) => Effect.Effect<RegistrationOrder, StorageError | NotFound>;
    /**
     * Flip the order at `submissions/<form>/orders/<orderId>.json` to `paid` and
     * return the resulting record (registrar plan C8 — the webhook's terminal
     * reconcile step, after the route has verified the charged amount matches the
     * order's frozen `amount`). **Idempotent**: replaying the same
     * `payment_intent.succeeded` event (Stripe retries until 200, and the
     * `c8c4abd` idempotency fix proves a verbatim retry must not double-apply)
     * re-reads an already-`paid` order and returns it UNCHANGED — no second write,
     * no status churn. The order record is the live payment-status surface (the
     * submission-`payment` backfill is latent — see plan Risks), so this flips the
     * ORDER; the registrant submissions it names (`registrantIds`) are paid by
     * virtue of their order being paid. Fails `NotFound` when no such order
     * exists (an event for an unknown order — the route maps it to a 400 so Stripe
     * retries until the order has landed), `StorageError` on a bucket fault.
     */
    readonly markOrderPaid: (
      form: FormId,
      orderId: string,
    ) => Effect.Effect<RegistrationOrder, StorageError | NotFound>;
    /**
     * Flip the order to `failed` and return it (a `payment_intent.payment_failed`
     * event). Idempotent in the same shape as {@link markOrderPaid}: a re-read of
     * an already-`failed` order returns it unchanged. A `paid` order is NEVER
     * downgraded to `failed` (a succeeded event already reconciled it; a stray
     * later failure event for the same intent is ignored) — only a non-terminal
     * (`pending`/`expired`) order transitions. Same failure channel.
     */
    readonly markOrderFailed: (
      form: FormId,
      orderId: string,
    ) => Effect.Effect<RegistrationOrder, StorageError | NotFound>;
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

    // Read one frozen order back off the bucket and decode it through its own
    // codec. A stored order ALWAYS decodes (it was written by `persistOrder` from
    // the same schema), so a decode failure is bucket corruption — it dies rather
    // than masquerading as a `NotFound`/`StorageError`. The `NotFound` is real and
    // user-facing: an event for an order that has not landed yet (the route 400s
    // so Stripe retries). Shared by both `mark*` flips below (DRY read-back).
    const readOrder = Effect.fn('Submissions.readOrder')(function* (
      form: FormId,
      orderId: string,
    ) {
      const object = yield* storage.get(orderKey(form, orderId));
      const text = yield* Effect.promise(() =>
        new Response(object.stream).text(),
      );
      return yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(RegistrationOrder),
      )(text).pipe(Effect.orDie);
    });

    // Read-flip-persist with an idempotent terminal-state short-circuit. Replaying
    // the same webhook event (Stripe retries until 200) re-reads an order already
    // in `target` and returns it WITHOUT a second write, so the flip is a no-op on
    // replay (mirrors the `c8c4abd` idempotency discipline). `guard` decides which
    // current statuses may transition: `markOrderPaid` flips from any non-`paid`
    // state; `markOrderFailed` refuses to downgrade an already-`paid` order.
    const flipStatus = (
      form: FormId,
      orderId: string,
      target: RegistrationOrder['status'],
      guard: (current: RegistrationOrder['status']) => boolean,
    ) =>
      Effect.gen(function* () {
        const order = yield* readOrder(form, orderId);
        if (order.status === target || !guard(order.status)) return order;
        const next: RegistrationOrder = { ...order, status: target };
        return yield* persistOrder(form, next);
      });

    const markOrderPaid = Effect.fn('Submissions.markOrderPaid')(function* (
      form: FormId,
      orderId: string,
    ) {
      // Any non-`paid` order (pending/failed/expired) may settle to `paid`: a
      // confirmed charge is authoritative over an earlier non-terminal state.
      return yield* flipStatus(form, orderId, 'paid', () => true);
    });

    const markOrderFailed = Effect.fn('Submissions.markOrderFailed')(function* (
      form: FormId,
      orderId: string,
    ) {
      // Never downgrade a `paid` order: a succeeded event already reconciled it,
      // so a stray later failure for the same intent is ignored (the `guard`).
      return yield* flipStatus(
        form,
        orderId,
        'failed',
        (current) => current !== 'paid',
      );
    });

    return Service.of({
      persist,
      persistOrder,
      getOrder: readOrder,
      markOrderPaid,
      markOrderFailed,
    });
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

export * as Submissions from './submissions.server';

import { Clock, Context, DateTime, Effect, Layer, Option, Schema } from 'effect';

import { Content } from '../content.server';
import {
  type FormId,
  orderKey,
  ordersPrefix,
  submissionKey,
} from '../content/pages/registry';
import {
  deterministicListItemId,
  IsoDate,
  type ListItemId,
  newListItemId,
} from '../content/schema';
import { type NotFound, Storage, type StorageError } from '../storage.server';

import { canTransition } from '../order/transitions';

import type { DecodedForm } from './decode';
import { RegistrationOrder } from './order';
import { OrderConflict } from './order-conflict';
import {
  type PaymentState,
  submissionSchema,
  type Submission,
} from './submission';

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

/**
 * The outcome of committing a registration resubmit through
 * `createOrReuseOrder` (order-workflow round-2 --deep H1). A closed union so the
 * action branches exhaustively: a `created` order is the only one the action
 * stamps registrants `pending` + `arm`s; `reused` reuses the live pending order's
 * replayed session WITHOUT restamping; `alreadyPaid` returns the existing
 * success/receipt WITHOUT minting a session or restamping. `OrderConflict` (case
 * d) is a failure, not an outcome.
 */
export type OrderCreateOutcome =
  | { readonly _tag: 'created'; readonly order: RegistrationOrder }
  | { readonly _tag: 'reused'; readonly order: RegistrationOrder }
  | { readonly _tag: 'alreadyPaid'; readonly order: RegistrationOrder };

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
     * Resolve the order SLOT a same-payload registration resubmit must land on
     * (order-workflow round-2 --deep H1). The deterministic `baseOrderId` (the
     * request fingerprint, possibly `:index`) is stable across a verbatim
     * resubmit, so a naive `persistOrder` at that key would silently OVERWRITE
     * whatever order already lives there — including an already-PAID order
     * (restamping its registrants `pending`, the F1 resurrection class through
     * the CREATE path) or a non-paid TERMINAL (cancelled/expired/refunded/failed)
     * the user is legitimately re-registering after.
     *
     * This reads the order(s) at `baseOrderId` FIRST and returns the slot the
     * resubmit should use, WITHOUT writing anything:
     *
     *   - the LIVE order at `baseOrderId` is `pending` or `paid` ⇒ that
     *     generation is still the active one; the caller reuses it (case (b)
     *     pending reuse / case (a) already-paid). `existing` is `Some(order)`,
     *     `orderId` is `baseOrderId`.
     *   - the order at `baseOrderId` is a non-paid TERMINAL (case (c)) ⇒ it is a
     *     DEAD order the user is re-registering past. A new pending must NOT
     *     overwrite it, and it cannot reuse the same key, so this walks to the
     *     NEXT free generation (`baseOrderId#g1`, `#g2`, …) — the lowest
     *     generation whose slot is absent OR live — and returns THAT as the fresh
     *     `orderId` (`existing` `None`). Deterministic: a verbatim resubmit
     *     re-walks the same dead terminals to the same generation, so it
     *     idempotently lands on the same fresh slot (no runaway generations).
     *   - no order at `baseOrderId` at all ⇒ a first submission; `orderId` is
     *     `baseOrderId`, `existing` `None`.
     *
     * The caller mints its Checkout session keyed off the RETURNED `orderId` (so
     * a fresh generation gets a fresh session, and a reuse replays the same one)
     * and then commits through {@link createOrReuseOrder}.
     */
    readonly resolveOrderSlot: (
      form: FormId,
      baseOrderId: string,
    ) => Effect.Effect<
      { readonly orderId: string; readonly existing: Option.Option<RegistrationOrder> },
      StorageError
    >;
    /**
     * Commit a registration resubmit against the slot {@link resolveOrderSlot}
     * resolved, implementing the CONFIRMED resubmit UX (order-workflow round-2
     * --deep H1). The caller passes the freshly-built `proposed` order (carrying
     * the resolved `orderId` + the just-minted `sessionId`); this re-reads the
     * order at `proposed.orderId` to decide:
     *
     *   - absent ⇒ write `proposed` as a fresh `pending` order; outcome
     *     `{ _tag: 'created' }`. The caller stamps registrants `pending` + arms.
     *   - existing `paid` ⇒ do NOT overwrite, do NOT restamp; outcome
     *     `{ _tag: 'alreadyPaid', order }` carrying the EXISTING paid order. The
     *     caller returns the existing success/receipt (case (a)).
     *   - existing `pending` whose frozen fields MATCH `proposed`
     *     (amount/currency/receiptEmail/mode/registrantIds) ⇒ idempotent retry;
     *     do NOT overwrite, do NOT restamp; outcome `{ _tag: 'reused', order }`
     *     carrying the EXISTING order (case (b)). The caller reuses the replayed
     *     session.
     *   - existing `pending` whose frozen fields CONFLICT ⇒ fail with
     *     {@link OrderConflict} (case (d)).
     *   - existing non-paid TERMINAL ⇒ this is unreachable on the happy path
     *     ({@link resolveOrderSlot} already walked past a dead terminal to a fresh
     *     generation), but if a terminal somehow lands here it is treated as a
     *     hard guard violation and FAILS `OrderConflict` rather than overwriting —
     *     NEVER restamp a terminal order back to `pending`.
     *
     * The write is a single `persistOrder`; a `paid`/`reused` outcome performs NO
     * write at all (byte-identical idempotent resubmit). This is the CREATE-path
     * analog of the `markOrder*` `canTransition` guards (F1) — the resubmit can
     * never resurrect a terminal nor restamp a settled order.
     */
    readonly createOrReuseOrder: (
      form: FormId,
      proposed: RegistrationOrder,
    ) => Effect.Effect<OrderCreateOutcome, StorageError | OrderConflict>;
    /**
     * Stamp a `PaymentState` onto an already-persisted registrant `Submission`
     * (`submissions/<form>/<id>.json`) and return the updated record. Re-reads the
     * stored record, replaces its `payment` envelope field, and re-writes it — so
     * order-creation can mark each affected registrant `pending`, and the webhook
     * (C8) can flip them `paid`/`failed` alongside the order (registrar plan :695
     * "PaymentState on the submission envelope"; C8 :904 "mark order + registrants
     * paid"). **Idempotent**: writing the SAME `payment` an already-stamped record
     * carries re-writes byte-identical content (no status churn), mirroring the
     * order flip. A stored registrant ALWAYS decodes (it was written by `persist`
     * from the same definition-derived codec), so a decode failure is bucket
     * corruption and dies; `NotFound` is real and user-facing (a webhook event that
     * names a registrant whose record has not landed).
     */
    readonly setRegistrantPayment: (
      form: FormId,
      id: ListItemId,
      payment: PaymentState,
    ) => Effect.Effect<Submission, StorageError | NotFound>;
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
     * List every frozen order of a form (the objects under `ordersPrefix(form)`
     * = `submissions/<form>/orders/`), decoding each back to a
     * `RegistrationOrder`. The deadline sweep (order-workflow G9) lists the
     * pending orders past their `deadline` to `expire` them; this is the read
     * half (the sweep filters + dispatches). The `orders/` prefix nests UNDER the
     * form's submission root but the registrant submissions sit one level up
     * (`submissions/<form>/<id>.json`, NOT under `orders/`), so this returns
     * orders ONLY — never a registrant record. A stored order ALWAYS decodes (it
     * was written by `persistOrder` from this same schema), so a decode failure
     * is bucket corruption and dies (mirroring `getOrder`), never a soft skip
     * that would silently drop an order from the sweep. `StorageError` on a
     * bucket-list fault.
     */
    readonly listOrders: (
      form: FormId,
    ) => Effect.Effect<readonly RegistrationOrder[], StorageError>;
    /**
     * Flip the order at `submissions/<form>/orders/<orderId>.json` to `paid` AND
     * stamp each registrant submission it names (`registrantIds`) `paid` in
     * lock-step, returning the resulting order (registrar plan C8 :904 — "mark
     * order + registrants paid", the webhook's terminal reconcile step, after the
     * route has verified the charged amount matches the order's frozen `amount`).
     * **Idempotent**: replaying the same `checkout.session.completed` event (Stripe
     * retries until 200, and the `c8c4abd` idempotency fix proves a verbatim retry
     * must not double-apply) re-reads an already-`paid` order, returns it UNCHANGED
     * — no second write — and re-stamps each registrant with a byte-identical
     * `paid` state (no status churn). The registrant flip mirrors the order's
     * frozen `mode`/`amount`/`currency` plus a `paidAt` calendar date, so the
     * registrant record carries its own paid status (plan :695) — order and
     * registrant can never disagree. Fails `NotFound` when no such order exists (an
     * event for an unknown order — the route maps it to a 400 so Stripe retries
     * until the order has landed), `StorageError` on a bucket fault.
     */
    readonly markOrderPaid: (
      form: FormId,
      orderId: string,
    ) => Effect.Effect<RegistrationOrder, StorageError | NotFound>;
    /**
     * Flip the order to `failed` AND stamp each registrant it names `failed` in
     * lock-step, returning the order (a `checkout.session.async_payment_failed` event).
     * Idempotent in the same shape as {@link markOrderPaid}: a re-read of an
     * already-`failed` order returns it unchanged and re-stamps each registrant
     * byte-identically. A `paid` order is NEVER downgraded to `failed` (a succeeded
     * event already reconciled it; a stray later failure event for the same intent
     * is ignored) — only a non-terminal (`pending`/`expired`) order transitions,
     * and when it does NOT transition the registrants are left untouched (a paid
     * registrant is never downgraded either). Same failure channel.
     */
    readonly markOrderFailed: (
      form: FormId,
      orderId: string,
    ) => Effect.Effect<RegistrationOrder, StorageError | NotFound>;
    /**
     * Flip the order to `cancelled` AND stamp each registrant it names
     * `cancelled` in lock-step, returning the order (the durable Order actor's
     * operator/abandon `cancel` op, G5/G7). ONLY a `pending` order transitions —
     * the same never-downgrade-a-terminal guard as {@link markOrderFailed}: a
     * `paid`/`failed`/`expired`/`refunded` order is left untouched (and its
     * registrants with it). `cancelled` is DISTINCT from `failed` (operator
     * abandon vs Stripe `async_payment_failed`). Idempotent in the same shape: a
     * re-flip of an already-`cancelled` order returns it unchanged and re-stamps
     * each registrant byte-identically. Same failure channel.
     */
    readonly markOrderCancelled: (
      form: FormId,
      orderId: string,
    ) => Effect.Effect<RegistrationOrder, StorageError | NotFound>;
    /**
     * Flip the order to `expired` AND stamp each registrant it names `expired` in
     * lock-step, returning the order (the deadline-sweep `expire` op, G7). ONLY a
     * `pending` order transitions — a settled (`paid`) or otherwise-terminal
     * order is never swept. Idempotent like {@link markOrderCancelled}.
     */
    readonly markOrderExpired: (
      form: FormId,
      orderId: string,
    ) => Effect.Effect<RegistrationOrder, StorageError | NotFound>;
    /**
     * Flip the order to `refunded` AND stamp each registrant it names `refunded`
     * in lock-step, returning the order (the `refund` op, G7 — the only
     * transition reachable FROM `paid`). ONLY a `paid` order transitions; a
     * `pending`/`failed`/`expired`/`cancelled` order is left untouched (refunding
     * an unsettled order is meaningless). The refund's calendar date
     * (`refundedAt`) is FROZEN onto the order the instant it transitions and
     * never re-stamped — so a re-flip on a LATER date re-reads it rather than the
     * clock, and each registrant's `refundedAt` derives FROM the order's frozen
     * stamp (`derive-dont-sync`), byte-identical on every replay. Same failure
     * channel.
     */
    readonly markOrderRefunded: (
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

      // PRESERVE an already-stamped payment lifecycle on an idempotent overwrite
      // (order-workflow round-2 --deep H1). With an `idempotencyKey` a verbatim
      // resubmit re-derives the SAME id and OVERWRITES the existing record — but
      // the order/webhook flow may have already stamped that registrant
      // `pending`/`paid`/… (`setRegistrantPayment`). A naive overwrite would write
      // a fresh record with NO `payment`, silently WIPING the paid stamp (the
      // restamp hazard H1 closes on the order side, mirrored here on the registrant
      // side). So a keyed persist carries the existing record's `payment` forward;
      // a keyless persist (single-record forms) has no prior record to preserve.
      const existingPayment: PaymentState | undefined =
        idempotencyKey === undefined
          ? undefined
          : yield* readSubmissionOption(form, id).pipe(
              Effect.map((record) =>
                Option.isSome(record) ? record.value.payment : undefined,
              ),
            );

      const submission: Submission =
        existingPayment === undefined
          ? { id, form, submittedAt, payload: decoded }
          : { id, form, submittedAt, payload: decoded, payment: existingPayment };

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

    // Read one persisted registrant `Submission` back off the bucket and decode it
    // through its definition-derived codec. A stored registrant ALWAYS decodes (it
    // was written by `persist` from this same codec), so a decode failure is bucket
    // corruption — it dies rather than masquerading as a `NotFound`/`StorageError`.
    // The `NotFound` is real: a webhook event naming a registrant whose record has
    // not landed (the route 400s so Stripe retries). The form definition is read
    // through `Content` so the payload codec is derived, never re-declared.
    const readSubmission = Effect.fn('Submissions.readSubmission')(function* (
      form: FormId,
      id: ListItemId,
    ) {
      const definition = yield* content.getForm(form);
      const schema = submissionSchema(definition);
      const object = yield* storage.get(submissionKey(form, id));
      const text = yield* Effect.promise(() =>
        new Response(object.stream).text(),
      );
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(
        text,
      ).pipe(Effect.orDie);
    });

    // `readSubmission`'s Option flavour: a missing record is a benign absence
    // (`None`), not a `NotFound` — `persist` uses it to discover whether an
    // idempotent overwrite has a prior record whose `payment` lifecycle must be
    // carried forward (H1). A real `StorageError` still propagates.
    const readSubmissionOption = Effect.fn('Submissions.readSubmissionOption')(
      function* (form: FormId, id: ListItemId) {
        return yield* readSubmission(form, id).pipe(
          Effect.map(Option.some<Submission>),
          Effect.catchTag('Storage.NotFound', () => Effect.succeedNone),
        );
      },
    );

    const setRegistrantPayment = Effect.fn('Submissions.setRegistrantPayment')(
      function* (form: FormId, id: ListItemId, payment: PaymentState) {
        const definition = yield* content.getForm(form);
        const schema = submissionSchema(definition);
        const current = yield* readSubmission(form, id);
        const next: Submission = { ...current, payment };
        // Re-encodes through the same derived codec the read used; a failure is an
        // upstream bug (a `payment` that never satisfied `PaymentState`), so it dies
        // rather than masquerading as a `StorageError` — the encode is the
        // validation, exactly as `persist`'s is. Re-writing the SAME `payment` an
        // already-stamped record carries produces byte-identical content (the
        // idempotent replay path).
        const json = yield* Schema.encodeUnknownEffect(
          Schema.fromJsonString(schema),
        )(next).pipe(Effect.orDie);
        yield* storage.put(submissionKey(form, id), json, 'application/json');
        return next;
      },
    );

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

    // `readOrder`'s Option flavour for the resubmit guard: a missing order is a
    // benign absence (`None`), not a user-facing `NotFound` — `resolveOrderSlot`
    // probes generations expecting most to be absent. A real `StorageError` (a
    // bucket fault) still propagates; only the `NotFound` is folded to `None`.
    const readOrderOption = Effect.fn('Submissions.readOrderOption')(function* (
      form: FormId,
      orderId: string,
    ) {
      return yield* readOrder(form, orderId).pipe(
        Effect.map(Option.some<RegistrationOrder>),
        Effect.catchTag('Storage.NotFound', () => Effect.succeedNone),
      );
    });

    // A non-paid TERMINAL order is a DEAD slot the resubmit must walk past
    // (cancelled/expired/refunded/failed). `pending` is live (reuse), `paid` is
    // live-and-settled (return the receipt) — neither is "dead". The transition
    // table is the source of truth for terminality, but the resubmit's branch is
    // status-shaped (live-pending / live-paid / dead-terminal), so it reads the
    // status directly here rather than `canTransition` (which answers a different
    // question — "may from→to flip").
    const isDeadTerminal = (status: RegistrationOrder['status']): boolean =>
      status === 'cancelled' ||
      status === 'expired' ||
      status === 'refunded' ||
      status === 'failed';

    // Resolve the generation a resubmit lands on (H1 case (c)). Walk
    // `baseOrderId`, `baseOrderId#g1`, `#g2`, … until the slot is absent OR live
    // (pending/paid): a dead terminal at a generation means the user re-registered
    // past it, so the next generation is the fresh slot. Deterministic — a
    // verbatim resubmit re-walks the same dead terminals to the same generation,
    // so it never runs away minting new generations. The cap is a safety bound
    // (a real submission re-registering hundreds of times is pathological); it
    // dies loudly rather than looping unbounded.
    const generationOrderId = (baseOrderId: string, generation: number): string =>
      generation === 0 ? baseOrderId : `${baseOrderId}#g${generation}`;
    const MAX_GENERATIONS = 1000;
    const resolveOrderSlot = Effect.fn('Submissions.resolveOrderSlot')(
      function* (form: FormId, baseOrderId: string) {
        for (let generation = 0; generation < MAX_GENERATIONS; generation += 1) {
          const orderId = generationOrderId(baseOrderId, generation);
          const existing = yield* readOrderOption(form, orderId);
          // Absent ⇒ a fresh slot at this generation.
          if (Option.isNone(existing)) {
            return { orderId, existing: Option.none<RegistrationOrder>() };
          }
          // Live (pending/paid) ⇒ this generation is the active one; reuse it.
          if (!isDeadTerminal(existing.value.status)) {
            return { orderId, existing };
          }
          // Dead terminal ⇒ walk to the next generation.
        }
        return yield* Effect.die(
          new Error(
            `resolveOrderSlot exhausted ${MAX_GENERATIONS} generations for ${baseOrderId}`,
          ),
        );
      },
    );

    // Compare the frozen fields a resubmit must agree on with a live `pending`
    // order to be an idempotent retry (H1 case (b) vs (d)). The session id is
    // DELIBERATELY excluded: a verbatim resubmit replays the SAME Stripe session
    // (idempotency key), so a matching resubmit re-mints the same `sessionId`, but
    // the equality that decides reuse-vs-conflict is the MONEY + receipt routing
    // (amount/currency/receiptEmail/mode) and which registrants the order pays for
    // — those are what must never be silently overwritten. Returns the first
    // disagreeing field name, or `undefined` when every frozen field matches.
    const conflictReason = (
      existing: RegistrationOrder,
      proposed: RegistrationOrder,
    ): string | undefined => {
      if (existing.mode !== proposed.mode) return 'mode';
      if (existing.amount !== proposed.amount) return 'amount';
      if (existing.currency !== proposed.currency) return 'currency';
      if (existing.receiptEmail !== proposed.receiptEmail) return 'receiptEmail';
      if (
        existing.registrantIds.length !== proposed.registrantIds.length ||
        existing.registrantIds.some((id, i) => id !== proposed.registrantIds[i])
      ) {
        return 'registrantIds';
      }
      return undefined;
    };

    const createOrReuseOrder = Effect.fn('Submissions.createOrReuseOrder')(
      function* (form: FormId, proposed: RegistrationOrder) {
        const existing = yield* readOrderOption(form, proposed.orderId);
        // No order at this slot ⇒ write the fresh `pending` order.
        if (Option.isNone(existing)) {
          const order = yield* persistOrder(form, proposed);
          return { _tag: 'created', order } satisfies OrderCreateOutcome;
        }
        const current = existing.value;
        // Already PAID (case a) ⇒ return the existing receipt; NEVER overwrite or
        // restamp. The action skips the session + the registrant restamp.
        if (current.status === 'paid') {
          return { _tag: 'alreadyPaid', order: current } satisfies OrderCreateOutcome;
        }
        // A non-paid TERMINAL must never reach here — `resolveOrderSlot` already
        // walked past it to a fresh generation. If one does (a caller that bypassed
        // the slot resolver), fail rather than overwrite it back to `pending`.
        if (isDeadTerminal(current.status)) {
          return yield* new OrderConflict({
            orderId: proposed.orderId,
            reason: `terminal order (${current.status}) cannot be reused`,
          });
        }
        // Live `pending`: idempotent retry iff the frozen fields match (case b);
        // a fingerprint collision with disagreeing fields fails explicitly (case
        // d). Either way the existing order is NOT overwritten and its registrants
        // are NOT restamped.
        const reason = conflictReason(current, proposed);
        if (reason !== undefined) {
          return yield* new OrderConflict({ orderId: proposed.orderId, reason });
        }
        return { _tag: 'reused', order: current } satisfies OrderCreateOutcome;
      },
    );

    // List every frozen order under `ordersPrefix(form)` and decode each. The
    // sweep (G9) reads this to find pending orders past their deadline. A stored
    // order ALWAYS decodes (written by `persistOrder` from this same schema), so
    // a decode failure is bucket corruption and dies — never a soft skip that
    // would silently drop an order from the sweep. The `orders/` prefix returns
    // ORDERS ONLY (registrant submissions sit one level up, not under it).
    const decodeOrder = Schema.decodeUnknownEffect(
      Schema.fromJsonString(RegistrationOrder),
    );
    const listOrders = Effect.fn('Submissions.listOrders')(function* (
      form: FormId,
    ) {
      const listed = yield* storage.list(ordersPrefix(form));
      const orders = yield* Effect.forEach(listed, (object) =>
        Effect.gen(function* () {
          const stored = yield* storage.get(object.key);
          const text = yield* Effect.promise(() =>
            new Response(stored.stream).text(),
          );
          return yield* decodeOrder(text).pipe(Effect.orDie);
        }).pipe(
          Effect.map(Option.some<RegistrationOrder>),
          // An order LISTED then `get`-missed is a benign TOCTOU race (it was
          // deleted between the list and the read) — skip it rather than failing
          // the whole sweep, keeping the channel `StorageError` (the list/get
          // bucket fault), never `NotFound`.
          Effect.catchTag('Storage.NotFound', () => Effect.succeedNone),
        ),
      );
      return orders.flatMap((order) =>
        Option.isSome(order) ? [order.value] : [],
      );
    });

    // Read-flip-persist over BOTH the order AND the registrant submissions it names
    // (`registrantIds`), idempotent end-to-end. `guard` decides which current order
    // statuses may transition: `markOrderPaid` settles ONLY a `pending` order to
    // `paid` (the G4 `canTransition` table — a late completion on an
    // `expired`/`cancelled`/`refunded`/`failed` terminal is rejected, never
    // resurrected); `markOrderFailed` likewise gates on `canTransition` and refuses
    // to downgrade an already-`paid` order. When the guard
    // forbids the transition AND the order is not already at `target`, NOTHING is
    // touched (a paid order's registrants are never downgraded by a stray failure).
    //
    // Otherwise — the order is at `target`, or may transition to it — the order is
    // written (only when it actually changes, so a replay is a no-op write on the
    // order) and EVERY registrant is re-stamped with `registrantPayment(order)`.
    // Re-stamping on the already-`target` path is deliberate: it converges a flip
    // that on a first delivery wrote the order but failed mid-registrant-loop, and
    // it is byte-identical on a clean replay (no churn) — mirroring the `c8c4abd`
    // idempotency discipline across the two-sided write. `registrantPayment` reads
    // the order's FROZEN `mode`/`amount`/`currency` (+ a `paidAt` for the paid arm),
    // so order and registrant carry the same lifecycle by construction.
    //
    // `transition` builds the order to WRITE when it actually changes — it runs ONCE,
    // only on the real transition (never on a replay that re-reads an order already
    // at `target`), so any timestamp it freezes (`markOrderPaid`'s `paidAt`) is
    // stamped exactly once and re-read verbatim on every later replay. `settled` is
    // the source the registrant stamp derives its frozen amounts AND `paidAt` from,
    // so a replay on a LATER date writes a byte-identical registrant record.
    const flipStatus = (
      form: FormId,
      orderId: string,
      target: RegistrationOrder['status'],
      guard: (current: RegistrationOrder['status']) => boolean,
      transition: (
        order: RegistrationOrder,
      ) => Effect.Effect<RegistrationOrder>,
      registrantPayment: (
        order: RegistrationOrder,
      ) => Effect.Effect<PaymentState>,
    ) =>
      Effect.gen(function* () {
        const order = yield* readOrder(form, orderId);
        // Guard forbids the transition and we are not already there ⇒ leave the
        // order AND its registrants untouched.
        if (order.status !== target && !guard(order.status)) return order;
        // Write the order only when it actually changes (a replay re-reads it
        // already at `target` and skips the write); the returned/settled order is
        // the source the registrant stamp reads its frozen amounts from. The
        // already-`target` order is re-read VERBATIM (its frozen `paidAt` intact),
        // so the convergence re-stamp derives the same value the first flip froze.
        const settled: RegistrationOrder =
          order.status === target
            ? order
            : yield* persistOrder(form, yield* transition(order));
        const payment = yield* registrantPayment(settled);
        // Stamp every named registrant in lock-step (idempotent — byte-identical on
        // replay). A `NotFound`/`StorageError` here propagates so Stripe retries and
        // a later delivery converges the records that did not land.
        for (const id of settled.registrantIds) {
          yield* setRegistrantPayment(form, id, payment);
        }
        return settled;
      });

    const markOrderPaid = Effect.fn('Submissions.markOrderPaid')(function* (
      form: FormId,
      orderId: string,
    ) {
      // ONLY a `pending` order may settle to `paid` (the G4 transition table —
      // `canTransition(current, 'paid')`, the SINGLE source of truth in
      // `order/transitions.ts`; an already-`paid` order re-flips idempotently via
      // the identity case). A late `checkout.session.completed` racing an
      // `expired`/`cancelled`/`refunded`/`failed` terminal must NOT resurrect the
      // order to `paid` (a money/support hazard) — the guard rejects it, leaving
      // the terminal order AND its registrant stamps untouched. This guard runs at
      // the BUCKET authority, so the webhook's direct `markOrderPaid` call honors
      // the table BEFORE any bucket flip, even though the durable `settle` op also
      // consults the same predicate (no second source of truth, no resurrection).
      // The settled-on calendar date (`paidAt`) is FROZEN onto the order the
      // instant it transitions and never re-stamped, so a webhook replay on a LATER
      // date re-reads it rather than the clock. Each registrant is stamped `paid`
      // with the order's frozen mode/amount/currency plus that frozen `paidAt` —
      // byte-identical on every replay (the idempotency invariant the webhook owes).
      return yield* flipStatus(
        form,
        orderId,
        'paid',
        (current) => canTransition(current, 'paid'),
        // Read the clock ONCE, here, on the real transition only — a replay
        // re-reads the already-`paid` order verbatim and never enters this branch,
        // so `paidAt` cannot drift across deliveries.
        (order) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const paidAt = yield* decodeIsoDate(isoDateString(now)).pipe(
              Effect.orDie,
            );
            return { ...order, status: 'paid', paidAt } satisfies RegistrationOrder;
          }),
        // Derive the registrant `paidAt` FROM the order's frozen stamp
        // (`derive-dont-sync`), never from the clock — so order and registrant
        // carry the same settled date and a replay rewrites neither. The settled
        // order always carries `paidAt` (the transition froze it, and an already-
        // `paid` order was written with it), so a missing value is bucket
        // corruption and dies rather than masquerading as an undated paid stamp.
        (order) =>
          Effect.gen(function* () {
            if (order.paidAt === undefined) {
              return yield* Effect.die(
                new Error(`paid order ${order.orderId} has no frozen paidAt`),
              );
            }
            return {
              _tag: 'paid',
              orderId: order.orderId,
              mode: order.mode,
              amount: order.amount,
              currency: order.currency,
              paidAt: order.paidAt,
            } satisfies PaymentState;
          }),
      );
    });

    const markOrderFailed = Effect.fn('Submissions.markOrderFailed')(function* (
      form: FormId,
      orderId: string,
    ) {
      // ONLY a `pending` order may flip to `failed` (the G4 transition table —
      // `canTransition(current, 'failed')`, the SINGLE source of truth in
      // `order/transitions.ts`; an already-`failed` order re-flips idempotently via
      // the identity case). A stray `async_payment_failed` racing an
      // `expired`/`cancelled`/`refunded`/`paid` terminal must NOT overwrite it —
      // the guard rejects it, leaving the terminal order AND its registrant stamps
      // untouched (the documented legal transitions are `pending → failed` plus
      // identity ONLY; `paid` was always protected, and now every other terminal
      // is too). Each registrant is stamped `failed`, carrying the order link + a
      // short reason (no amount/paidAt — there is nothing settled).
      return yield* flipStatus(
        form,
        orderId,
        'failed',
        (current) => canTransition(current, 'failed'),
        // A failed transition freezes no timestamp — there is nothing settled.
        (order) => Effect.succeed({ ...order, status: 'failed' } satisfies RegistrationOrder),
        (order) =>
          Effect.succeed({
            _tag: 'failed',
            orderId: order.orderId,
            mode: order.mode,
            reason: 'checkout.session.async_payment_failed',
          } satisfies PaymentState),
      );
    });

    const markOrderCancelled = Effect.fn('Submissions.markOrderCancelled')(
      function* (form: FormId, orderId: string) {
        // Only a `pending` order may be cancelled — a settled (`paid`) or
        // otherwise-terminal order is never downgraded (the same guard shape as
        // `markOrderFailed`). Each registrant is stamped `cancelled`, carrying the
        // order link + its frozen amount/currency (nothing was collected, so no
        // `paidAt`).
        return yield* flipStatus(
          form,
          orderId,
          'cancelled',
          (current) => current === 'pending',
          // A cancellation freezes no timestamp — there is nothing settled.
          (order) =>
            Effect.succeed({
              ...order,
              status: 'cancelled',
            } satisfies RegistrationOrder),
          (order) =>
            Effect.succeed({
              _tag: 'cancelled',
              orderId: order.orderId,
              mode: order.mode,
              amount: order.amount,
              currency: order.currency,
            } satisfies PaymentState),
        );
      },
    );

    const markOrderExpired = Effect.fn('Submissions.markOrderExpired')(
      function* (form: FormId, orderId: string) {
        // Only a `pending` order may be swept to `expired` — a settled or
        // otherwise-terminal order is never swept.
        return yield* flipStatus(
          form,
          orderId,
          'expired',
          (current) => current === 'pending',
          // Expiry freezes no timestamp.
          (order) =>
            Effect.succeed({
              ...order,
              status: 'expired',
            } satisfies RegistrationOrder),
          (order) =>
            Effect.succeed({
              _tag: 'expired',
              orderId: order.orderId,
              mode: order.mode,
              amount: order.amount,
              currency: order.currency,
            } satisfies PaymentState),
        );
      },
    );

    const markOrderRefunded = Effect.fn('Submissions.markOrderRefunded')(
      function* (form: FormId, orderId: string) {
        // ONLY a `paid` order may be refunded — the single transition reachable
        // FROM `paid`. A `pending`/`failed`/`expired`/`cancelled` order is left
        // untouched (refunding an unsettled order is meaningless). The refund's
        // calendar date is FROZEN onto the order the instant it transitions and
        // never re-stamped; each registrant's `refundedAt` derives FROM it, so a
        // re-flip on a LATER date rewrites byte-identical records.
        return yield* flipStatus(
          form,
          orderId,
          'refunded',
          (current) => current === 'paid',
          // Read the clock ONCE, on the real transition only — a re-flip re-reads
          // the already-`refunded` order verbatim and never enters this branch,
          // so `refundedAt` cannot drift across deliveries.
          (order) =>
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              const refundedAt = yield* decodeIsoDate(isoDateString(now)).pipe(
                Effect.orDie,
              );
              return {
                ...order,
                status: 'refunded',
                refundedAt,
              } satisfies RegistrationOrder;
            }),
          // Derive the registrant `refundedAt` FROM the order's frozen stamp
          // (`derive-dont-sync`), never from the clock. The settled order always
          // carries `refundedAt` (the transition froze it, and an already-
          // `refunded` order was written with it), so a missing value is bucket
          // corruption and dies rather than masquerading as an undated refund.
          (order) =>
            Effect.gen(function* () {
              if (order.refundedAt === undefined) {
                return yield* Effect.die(
                  new Error(
                    `refunded order ${order.orderId} has no frozen refundedAt`,
                  ),
                );
              }
              return {
                _tag: 'refunded',
                orderId: order.orderId,
                mode: order.mode,
                amount: order.amount,
                currency: order.currency,
                refundedAt: order.refundedAt,
              } satisfies PaymentState;
            }),
        );
      },
    );

    return Service.of({
      persist,
      persistOrder,
      resolveOrderSlot,
      createOrReuseOrder,
      setRegistrantPayment,
      getOrder: readOrder,
      listOrders,
      markOrderPaid,
      markOrderFailed,
      markOrderCancelled,
      markOrderExpired,
      markOrderRefunded,
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

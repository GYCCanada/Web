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

import type { DecodedForm } from './decode';
import { RegistrationOrder } from './order';
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
    // statuses may transition: `markOrderPaid` flips from any non-`paid` state;
    // `markOrderFailed` refuses to downgrade an already-`paid` order. When the guard
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
      // Any non-`paid` order (pending/failed/expired) may settle to `paid`: a
      // confirmed charge is authoritative over an earlier non-terminal state. The
      // settled-on calendar date (`paidAt`) is FROZEN onto the order the instant it
      // transitions and never re-stamped, so a webhook replay on a LATER date
      // re-reads it rather than the clock. Each registrant is stamped `paid` with
      // the order's frozen mode/amount/currency plus that frozen `paidAt` —
      // byte-identical on every replay (the idempotency invariant the webhook owes).
      return yield* flipStatus(
        form,
        orderId,
        'paid',
        () => true,
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
      // Never downgrade a `paid` order: a completed session already reconciled it,
      // so a stray later failure for the same session is ignored (the `guard`).
      // Each registrant is stamped `failed`, carrying the order link + a short
      // reason (no amount/paidAt — there is nothing settled).
      return yield* flipStatus(
        form,
        orderId,
        'failed',
        (current) => current !== 'paid',
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

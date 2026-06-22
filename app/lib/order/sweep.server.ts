export * as OrderSweep from './sweep.server';

import { Clock, DateTime, Duration, Effect, Layer, Schedule } from 'effect';

import { Submissions } from '../forms/submissions.server';
import type { RegistrationOrder } from '../forms/order';
import type { StorageError } from '../storage.server';

import { Order } from './runner.server';

/**
 * G9 — the deadline SWEEP: an in-process scheduled fiber that lapses pending
 * orders whose `deadline` has passed into `expired`.
 *
 * ## What it does
 *
 * It lists the form's frozen orders (`Submissions.listOrders` over
 * `ordersPrefix('registration')` = `submissions/registration/orders/`) and, for
 * each order that is BOTH `pending` AND past its `deadline`, `send`s the durable
 * `Order.expire` op. The `expire` handler flips `pending → expired` through the
 * never-downgrade `flipStatus` guard (`Submissions.markOrderExpired`, G5/G7), so
 * a `paid`/`refunded`/`cancelled`/`failed`/already-`expired` order is left
 * untouched even if it is somehow re-enumerated (make-impossible-states). The
 * filter pre-screens to `pending`-with-a-passed-deadline so the sweep only
 * dispatches where a transition is actually due; the handler's guard is the
 * second line of defence against a race (an order paid between the list and the
 * dispatch is never resurrected to `expired`).
 *
 * ## Where it lives (the load-bearing topology)
 *
 * It is launched in the long-lived `Layer.launch`-ed `ServerLive` graph
 * (`server.ts`) — a sweep is a PROCESS-LIFETIME fiber (it polls forever on a
 * schedule), so it needs the launch-time supervisor `ServerLive` provides, NOT
 * the request-handler `makeAppLayer` graph (consumed once into the `AppRuntime`
 * singleton, never `Layer.launch`-ed). It is a SENDER (`Order.expire.send`) into
 * the SAME SQL MessageStorage the runner consumes — the two coordinate through
 * the shared `DATABASE_URL` sqlite FILE, never an in-memory instance.
 *
 * ## Idempotency
 *
 * Re-sweeping is a no-op: a second pass re-`send`s `expire` for an order that the
 * first pass already flipped `expired` (it is no longer `pending`, so the filter
 * skips it) — and even a verbatim re-`send` dedups (encore primaryKey dedup) and
 * the `markOrderExpired` flip is byte-identical on an already-`expired` order.
 *
 * ## Trigger model (Open Question 5)
 *
 * The default is an IN-PROCESS scheduled fiber, valid because the DB decision is
 * a single always-on web instance (the same single-node assumption the runner
 * makes). If GYC ever scales to MULTIPLE web processes against one DB, the sweep
 * (like the runner) must move to a dedicated worker process / an external cron
 * hitting the manual trigger route below, so N instances do not each sweep. The
 * manual `/admin`-guarded trigger route (`app/routes/admin/orders.sweep.ts`)
 * exposes the same sweep for an operator / an external scheduler without
 * committing any infra.
 */

/** The form whose order lifecycle the sweep reconciles (the only paid form today). */
const SWEEP_FORM = 'registration';

/** How often the in-process fiber runs a sweep pass (a daily-deadline lifecycle
 * does not need a tight loop; hourly catches a lapsed order well within a day). */
const SWEEP_INTERVAL = Duration.hours(1);

/** Format a UTC millisecond instant as a `YYYY-MM-DD` calendar-date string —
 * the same shape `RegistrationOrder.deadline` (a branded `IsoDate`) carries, so a
 * lexicographic compare IS a calendar compare (both are zero-padded `YYYY-MM-DD`). */
const isoDateString = (millis: number): string =>
  DateTime.formatIso(DateTime.makeUnsafe(millis)).slice(0, 10);

/**
 * `true` iff `order` is due to expire AS OF `today` (a `YYYY-MM-DD` string): it
 * is `pending` AND carries a `deadline` that is STRICTLY before today. A
 * deadline-less order never expires by the sweep (a registration with no
 * registrationDeadline configured stays open); an order whose deadline IS today
 * is still open through the end of that day (strict `<`, not `<=`).
 */
const isExpirable = (order: RegistrationOrder, today: string): boolean =>
  order.status === 'pending' &&
  order.deadline !== undefined &&
  order.deadline < today;

/**
 * Run ONE sweep pass: enumerate the form's orders, dispatch `Order.expire` to
 * each that is due. Returns the orderIds it dispatched (the manual trigger route
 * reports the count; the in-process fiber ignores it). A `send` per due order is
 * fire-and-forget — the sweep does NOT block on the runner consuming it (the
 * durable `send` already landed in the SQL mailbox; the runner reconciles the
 * flip off it), mirroring how the registration action `arm`s without awaiting.
 *
 * The error channel is `StorageError` (the `listOrders` bucket-list fault) — a
 * genuinely-unreachable bucket fails the pass; the caller (the fiber's schedule /
 * the trigger route) decides how to surface it. The per-order `send` is the
 * durable seam, so a sweep that lists but cannot reach the runner still records
 * the intent in the mailbox.
 */
export const runOnce: Effect.Effect<
  readonly string[],
  StorageError,
  Submissions.Service | Order.SenderServices
> = Effect.gen(function* () {
  const submissions = yield* Submissions.Service;
  const now = yield* Clock.currentTimeMillis;
  const today = isoDateString(now);

  const orders = yield* submissions.listOrders(SWEEP_FORM);
  const due = orders.filter((order) => isExpirable(order, today));

  yield* Effect.forEach(
    due,
    (order) =>
      // The `expire` send is fire-and-forget into the SQL mailbox the runner
      // consumes — the durable seam. A send-infra fault (mailbox full, a
      // persistence blip, or a duplicate-in-flight `AlreadyProcessingMessage`)
      // for ONE order must not abort the whole pass NOR widen the channel beyond
      // the `listOrders` `StorageError`: it is logged + swallowed per order, so
      // the remaining due orders still dispatch and the next sweep retries the
      // failed one (a still-pending past-deadline order re-enters `due`).
      Order.Entity.expire.send({ orderId: order.orderId }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError(
            `Order sweep failed to dispatch expire for ${order.orderId}`,
            cause,
          ),
        ),
      ),
    { discard: true },
  );

  return due.map((order) => order.orderId);
});

/**
 * The forever-looping sweep: run a pass, log + swallow any per-pass fault, then
 * wait one interval and repeat. A bucket-list fault on one pass must NEVER kill
 * the loop (the next interval retries), so the pass is wrapped in `catchCause` →
 * log → continue. `Schedule.spaced(interval)` paces the loop AFTER each pass
 * completes, so a slow pass never overlaps itself.
 */
const sweepForever = (
  interval: Duration.Duration,
): Effect.Effect<void, never, Submissions.Service | Order.SenderServices> =>
  runOnce.pipe(
    Effect.flatMap((expired) =>
      expired.length === 0 ?
        Effect.void
      : Effect.logInfo(
          `Order sweep expired ${expired.length} past-deadline order(s): ${expired.join(', ')}`,
        ),
    ),
    Effect.catchCause((cause) =>
      Effect.logError('Order sweep pass failed (will retry next interval)', cause),
    ),
    // `Schedule.spaced` recurs FOREVER, waiting `interval` between passes — so a
    // pass never overlaps itself, and the loop only ends when the fiber is
    // interrupted (the launch-scope teardown). The pass never fails (faults are
    // caught above), so the loop never escapes.
    Effect.repeat(Schedule.spaced(interval)),
    Effect.asVoid,
  );

/**
 * The in-process sweep fiber as a `Layer` — a `Layer.effectDiscard` that forks a
 * fiber (running the sweep loop) into the LAYER's scope at build time.
 * `server.ts` merges this into `ServerLive` (gated on `Env.database` Some), so
 * `Layer.launch` supervises it: `forkScoped` ties the fiber to the launched
 * layer scope (`effectDiscard` excludes `Scope` from the layer's requirements —
 * the fork lives in the layer's own scope), so it is torn down with the server
 * (never an orphan), and `interruptible` lets the teardown stop it cleanly. A
 * sweep pass that faults is logged and the loop continues (see
 * {@link sweepForever}).
 */
export const fiberLayer = (
  interval: Duration.Duration = SWEEP_INTERVAL,
): Layer.Layer<never, never, Submissions.Service | Order.SenderServices> =>
  Layer.effectDiscard(
    sweepForever(interval).pipe(Effect.interruptible, Effect.forkScoped),
  );

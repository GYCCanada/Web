import { Schema } from 'effect';

/**
 * A same-payload registration resubmit landed on a LIVE `pending` order whose
 * frozen fields (amount / currency / receiptEmail / mode / registrantIds) do NOT
 * match the resubmitted order (order-workflow round-2 --deep H1, case (d)).
 *
 * The deterministic `orderId` (the request fingerprint, possibly `:index`) is a
 * stable hash of the submission payload, so a verbatim resubmit re-derives the
 * SAME id and idempotently REUSES the live pending order (case (b)). A
 * fingerprint COLLISION — two genuinely different orders hashing to the same id
 * while the first is still `pending` — is the only way the frozen fields can
 * disagree at a matching id. Rather than silently overwriting the live order's
 * frozen amount/receipt (the money/receipt-routing hazard the H1 guard closes),
 * `createOrReuseOrder` fails EXPLICITLY with this error: the resubmit cannot
 * proceed against a conflicting in-flight order.
 *
 * It is NOT HTTP-mapped at the boundary the way a 4xx is — the registration
 * action catches it and surfaces a form-level validation error (the same channel
 * a decode failure uses), so the visitor sees an explicit "this submission
 * conflicts with an in-flight order" message rather than a silent corruption.
 */
export class OrderConflict extends Schema.TaggedErrorClass<OrderConflict>()(
  'Order.Conflict',
  {
    orderId: Schema.String,
    /** A short, human-meaningful description of which frozen field disagreed. */
    reason: Schema.String,
  },
) {}

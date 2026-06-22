import { Schema } from 'effect';

import { IsoDate, ListItemId } from '../content/schema';

import { BillingMode } from './party';
import { Cents, CurrencyCode } from './pricing';

/**
 * The frozen `RegistrationOrder` record (registrar plan Decision 2 / 2b.6) — the
 * durable, amount-frozen receipt one checkout mints, stored as its own bucket
 * object at `submissions/registration/orders/<orderId>.json` (`orderKey`). It is
 * NOT the registrant `Submission` (that is the attendee's durable record); the
 * order is the PAYMENT's source of truth, linking a Stripe Checkout Session to the
 * registrant submission(s) it pays for.
 *
 * Cardinality (Decision 2, derived from the decoded `party._tag`):
 *   - `group` ⇒ ONE order keyed by the request fingerprint, `registrantIds` = the
 *     whole party, `receiptEmail` = the nominated `party.payer.email`;
 *   - `perRegistrant` (C7.5) ⇒ one order per registrant keyed
 *     `<fingerprint>:<index>`, `registrantIds` = the one id, `receiptEmail` =
 *     `registrants[i].email`.
 *
 * Modelling principles (`~/.brain/principles`):
 *   - the `amount` + `receiptEmail` are FROZEN at create-intent time (Decision 7):
 *     the webhook (C8) re-checks the charged amount against this frozen value, and
 *     the receipt is routed to this frozen address — never re-read from form data,
 *     so a later edit cannot retro-change what was charged or where the receipt
 *     went.
 *   - `make-impossible-states-unrepresentable`: `currency` is the closed
 *     `CurrencyCode` brand, `amount` the `Cents` brand (integer ≥0), `mode` the
 *     closed `BillingMode`, `status` a closed literal — every field that could be
 *     a free string is a closed token.
 *   - `receiptEmail` is a REQUIRED `Schema.String` (never `optionalKey`): every
 *     order is written with it, so a read-back never has to backfill a missing
 *     receipt (the CMS published-doc backfill hazard, guarded by construction).
 *
 * The encoded form IS the JSON stored under `orders/<orderId>.json`, so an order
 * round-trips losslessly through `encode → JSON → decode` (proven in its test).
 */
export const RegistrationOrder = Schema.Struct({
  // group: the request fingerprint; perRegistrant (C7.5): `<fingerprint>:<index>`.
  orderId: Schema.String,
  // The mode this order was minted under — the webhook (C8) and any read-back know
  // which cardinality reconciled it. Closed `BillingMode`, shared with the party
  // section + the shell discriminant (one definition, `derive-dont-sync`).
  mode: BillingMode,
  // The Stripe Checkout Session this order was minted against — the visitor is
  // redirected to its hosted URL to pay, and the `checkout.session.completed`
  // webhook (C8) carries this id back. Frozen at create-session time.
  sessionId: Schema.String,
  amount: Cents, // FROZEN at create-intent time
  currency: CurrencyCode,
  // FROZEN — group: party.payer.email (nominated, possibly a non-attendee);
  // perRegistrant: registrants[i].email (Decision 2b.6). Required, never absent.
  receiptEmail: Schema.String,
  status: Schema.Literals(['pending', 'paid', 'failed', 'expired']),
  // group: every party id; perRegistrant: the one id. The webhook flips each
  // named registrant submission's payment alongside the order (C8).
  registrantIds: Schema.Array(ListItemId),
  // Copied from pricing.registrationDeadline at create-intent when present (Q4).
  deadline: Schema.optionalKey(IsoDate),
  // FROZEN the instant the order first transitions to `paid` (C8 `markOrderPaid`),
  // and NEVER re-stamped thereafter — so a Stripe webhook replay on a LATER date
  // re-reads this same value rather than re-reading the clock. The registrant
  // `paid` stamp derives its own `paidAt` FROM this field (`derive-dont-sync`), so
  // a replayed `checkout.session.completed` writes a byte-identical registrant
  // record (no `paidAt` drift) — the idempotent-replay invariant the webhook owes.
  // `optionalKey` (never re-declared, backfill-safe): a `pending`/`failed`/`expired`
  // order has nothing settled, so it carries no `paidAt`; a read-back of a legacy
  // paid order written before this field existed tolerates its absence.
  paidAt: Schema.optionalKey(IsoDate),
});
export type RegistrationOrder = typeof RegistrationOrder.Type;

import { createHash } from 'node:crypto';

import { Clock, Effect, Option, Result } from 'effect';

import { Content } from '../content.server';
import { Env } from '../env.server';
import { formValidationError, redirect } from '../effect/errors';
import { getLocale, type Locale } from '../localization/localization';
import {
  type FormSuccess,
  routeFormAction,
  SubmissionContext,
} from '../effect/form';
import { formatSchemaResult, parseSchema } from '../effect/form-schema';
import { ReactRouterContext } from '../effect/router-context';
import { Mailer } from '../mailer.server';
import { Order } from '../order/runner.server';
import { Payment } from '../payment.server';
import { Toast } from '../toast.server';

import type { SuccessToast } from './action';
import type { RegistrationOrder } from './order';
import { priceGroup, priceRegistrant } from './price';
import { registrationShellSchema } from './registration-shell';
import type { Submission } from './submission';
import { Submissions } from './submissions.server';

/**
 * The registration server action (registration-launch Branch 7.3 — registration's
 * net-new server persist). Registration is the one form whose payload is NOT a
 * single flat field graph but a repeating `{ registrants: Registrant[] }` shell
 * (registration-spec §"Scope boundary"): a repeating-array-of-variant-items is not
 * a closed `FieldKind`, so it does NOT flow through the flat `formAction` skeleton.
 * It has its own action here, reusing the SAME machinery the flat skeleton uses
 * (`routeFormAction` + `decodeForm`'s codec + `Submissions.persist`) over the
 * array, so the persist-then-notify discipline is identical.
 *
 * Why net-new: the registration route's action was a deliberate no-op
 * (`registration-schema.ts`'s docstring: the schema was never run server-side —
 * only the client `RegistrationStandardSchema` validated). RegFox carries the live
 * 2026 channel (settled #9), so this on-site server path is built + proven but not
 * load-bearing for launch; it seeds the future first-party registrar (CONTEXT
 * §Submission:47) by persisting each registrant as its own durable `Submission`.
 *
 * Pipeline (the same shape `formAction` runs, lifted over the registrant array):
 *   1. `Content.getForm('registration')` → the registration `FormDefinition` (ONE
 *      registrant's graph — the route owns the array shell, registration-spec:39);
 *   2. decode `submission.payload` against
 *      `Schema.Struct({ registrants: Array(definitionToSchema(def)) })` — the same
 *      per-registrant codec the client validates with, wrapped in the array shell,
 *      so a field error keys as `registrants[0].email` (the conform field name the
 *      live form renders, via `formatSchemaResult`) → on failure,
 *      `formValidationError`;
 *   3. `Submissions.persist('registration', registrant)` for EACH decoded
 *      registrant → one durable `submissions/registration/<id>.json` object per
 *      registrant, written BEFORE any notification;
 *   4. `notify(stored)` over the persisted records (a failure cannot lose them —
 *      they are already on the bucket, settled #8);
 *   5. `toast.redirect(pathname, { success copy })`.
 *
 * `derive-dont-sync`: the validation codec AND the persisted payload codec both
 * derive from the stored `FormDefinition` (`definitionToSchema` /
 * `submissionSchema`), never a re-declared registrant struct — editing
 * `forms/registration.json` changes what the form accepts and what it stores with
 * no code change (ADR 0007 + ADR 0008).
 */

/**
 * Configure the registration action. `notify` runs the registration-specific
 * notification over the PERSISTED registrant records (already on the bucket, so
 * the email may reference each record's id) and fails (with any `AppError`, e.g. a
 * mailer failure mapped to a form-level key) to abort the redirect; `success` is
 * the post-submit toast copy.
 */
export interface RegistrationActionConfig<E> {
  readonly notify: (
    submissions: ReadonlyArray<Submission>,
  ) => Effect.Effect<
    void,
    E,
    ReactRouterContext | Content.Service | Mailer.Service
  >;
  /**
   * The `perRegistrant` Checkout-link mail (round-2 --deep BLOCKER fix). Each
   * minted `perRegistrant` Checkout Session belongs to a DIFFERENT registrant; a
   * single browser can only begin one of N hosted checkouts, so the action does
   * NOT redirect — it instead mails each registrant THEIR OWN hosted `url` here.
   * Called once per minted session (after ALL sessions are persisted), over the
   * persisted registrant `Submission` + its session `url`. It runs through the
   * SAME `Mailer` boundary `notify` uses (no new email layer); the session/order
   * is already durable + `pending` (persist-then-notify, :56), so a mail failure
   * surfaces a form-level error WITHOUT losing the minted sessions — they
   * reconcile on their own `checkout.session.completed` regardless.
   */
  readonly notifyPaymentLink: (input: {
    readonly submission: Submission;
    readonly url: string;
    readonly locale: Locale;
  }) => Effect.Effect<
    void,
    E,
    ReactRouterContext | Content.Service | Mailer.Service
  >;
  readonly success: SuccessToast;
  /**
   * The post-submit toast for the `perRegistrant` path — distinct from `success`
   * (group's redirect): honest that nothing is paid yet, "we've emailed each
   * person their payment link". Shown via `toast.redirect` to the form (no Stripe
   * redirect for perRegistrant).
   */
  readonly perRegistrantSuccess: SuccessToast;
}

/**
 * Build the registration route `action`. The three `{2024,2025,2026}/form` route
 * modules export `export const action = registrationAction({ notify, success })`
 * — no inline pipeline, exactly like a `formAction` caller. On the happy path the
 * terminal `toast.redirect` fails with a `RedirectError` the wrapper forwards, so
 * the {@link FormSuccess} return is unreachable on success.
 */
export const registrationAction = <E>(config: RegistrationActionConfig<E>) =>
  routeFormAction(function* () {
    const { url, params } = yield* ReactRouterContext;
    const submission = yield* SubmissionContext;
    const content = yield* Content.Service;
    const submissions = yield* Submissions.Service;
    const toast = yield* Toast;

    const env = yield* Env.Service;
    const payment = yield* Payment.Service;

    // The durable Order lifecycle anchor (order-workflow G7.1). After the action
    // synchronously mints + freezes a `RegistrationOrder` (the freeze stays at
    // this boundary — UNCHANGED below), it `send`s the Order `arm` op to record
    // the entity into existence at `pending`: a durable, fire-and-forget anchor
    // that does NOT block the redirect/mail handoff and does NOT re-create the
    // session. Gated on `Env.database` Some — a DB-less deploy skips the send and
    // the bucket path is byte-identically unchanged (the runner that consumes the
    // mailbox only exists when a DB is configured). A `send` fault is NOT allowed
    // to fail the registration: the bucket order is ALREADY durable (the
    // authority) and the webhook still reconciles it, so an arm-send failure is
    // logged and swallowed — the anchor is complementary to the bucket, never a
    // gate on it. Idempotency STRENGTHENS: a verbatim retry re-`send`s `arm` for
    // the SAME `orderId` ⇒ encore's primaryKey dedup collapses it to no second
    // entity, complementing the existing bucket-overwrite idempotency.
    const armOrder = (
      order: RegistrationOrder,
    ): Effect.Effect<void, never, Order.SenderServices> =>
      Option.isNone(env.database) ?
        Effect.void
      : Order.Entity.arm
          .send({
            orderId: order.orderId,
            mode: order.mode,
            amount: order.amount,
            currency: order.currency,
            receiptEmail: order.receiptEmail,
            sessionId: order.sessionId,
            registrantIds: order.registrantIds,
            deadline: order.deadline,
          })
          .pipe(
            Effect.asVoid,
            Effect.catchCause((cause) =>
              Effect.logError(
                `Order.arm send failed for ${order.orderId} (bucket order is durable; webhook still reconciles)`,
                cause,
              ),
            ),
          );

    const definition = yield* content.getForm('registration');

    // The registrant-array shell is registration's own concern (registration-spec
    // §"Scope boundary"): the engine owns ONE registrant's graph, the route owns
    // the `{ registrants: [...] }` envelope — and, once a form authors a `party`
    // section, the party block alongside it. `registrationShellSchema` (registrar
    // plan Decision 2b.4 / Decision 7 step 0) decodes that envelope: it validates
    // the chosen `party._tag` against the authored `billingMode.options`
    // allow-list, decodes the `group`-arm nominated payer (name + required email),
    // and drops blank non-leader registrant emails so an un-filled email decodes
    // valid (2b.3). A definition with no `party` (legacy / contact / volunteer)
    // decodes the today `{ registrants }` shell, group-implicit. Error paths stay
    // at `registrants[n].<field>` / `party.payer.<field>` — the conform field
    // names the live form renders.
    const decoded = parseSchema(
      registrationShellSchema(definition),
      submission.payload,
    );
    if (Result.isFailure(decoded)) {
      return yield* formValidationError(formatSchemaResult(decoded) ?? {});
    }
    const shell = decoded.success;

    // Persist each registrant FIRST — one durable `submissions/registration/<id>.json`
    // object apiece, written + returned before any notification runs, so a `notify`
    // failure provably cannot lose a record (settled #8). A `StorageError` aborts the
    // submission (losing a registrant must never look like success).
    //
    // Idempotency (the deep review's escalated partial-write): the loop is sequential
    // and a `StorageError` on registrant K aborts after 0..K-1 are already durable. A
    // user retry would otherwise re-mint fresh ids and DUPLICATE the records that did
    // land. Scoping each registrant's id to `<request fingerprint>:<index>` makes the
    // retry overwrite the same K objects instead: the fingerprint is a stable hash of
    // THIS submission's payload (identical on a verbatim retry, different for a new
    // submission even with identical data), and the index pins each registrant to its
    // position. So retrying a group of 4 that failed at #3 re-writes #1/#2 in place and
    // completes #3/#4 — no duplicates — while a genuinely new submission gets new ids.
    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify(submission.payload))
      .digest('hex');
    const stored: Array<Submission> = [];
    for (const [index, registrant] of shell.registrants.entries()) {
      stored.push(
        yield* submissions.persist(
          'registration',
          registrant,
          `${requestFingerprint}:${index}`,
        ),
      );
    }

    // On-site checkout (registrar plan Decision 2 / 2b / Decision 7), gated by the
    // `Env.stripe` `None`-gate (Decision 8) AND the presence of a `pricing`
    // dimension on the definition. When stripe is unconfigured the on-site payment
    // path is INERT — registration persists + notifies + redirects exactly as the
    // RegFox-era no-op did, so nothing changes until the gate flips.
    //
    // The `definition.pricing !== undefined` clause is load-bearing, NOT cosmetic:
    // `priceGroup`/`priceRegistrant` return `Cents(0)` for an UNPRICED form
    // (`price.ts` — absent `pricing` ⇒ 0, correctly), so a Stripe-enabled form that
    // authors a `party` section but NO pricing (the current default `registration`
    // form) would otherwise mint a ZERO-amount Checkout Session/order. Stripe is the
    // gate for "is on-site payment configured"; `pricing` is the gate for "does this
    // form actually charge". Both must hold — an unpriced form persists + notifies +
    // redirects with NO payment path (the pre-registrar behaviour), even with Stripe
    // configured. A computed amount of `0` for a PRICED submission is likewise
    // skipped per-checkout below (a fully-discounted / nothing-selected registrant
    // never mints a zero-amount session).
    //
    // When all three hold (stripe configured, `party` authored, `pricing` present)
    // the decoded `party._tag` drives cardinality + receipt routing (the
    // orthogonality table row (ii), Decision 2b.6):
    //   - `group`         ⇒ ONE order for the party sum, ONE session, receipt to the
    //                       NOMINATED payer (possibly a non-attendee);
    //   - `perRegistrant` ⇒ N orders/sessions — one per registrant, each frozen on
    //                       that registrant's own price + email.
    //
    // Checkout handoff (the round-1 `--deep` BLOCKER fix + the round-2 perRegistrant
    // correction): each session is a HOSTED Stripe Checkout page where the card is
    // actually collected + charged. The order stays `pending`; the paid status +
    // receipt move to webhook reconciliation (`checkout.session.completed`, C8), so
    // we do NOT `notify` here (nothing is settled yet). The handoff is mode-branched
    // below: `group` (one session) REDIRECTS the browser to its hosted `url` (303);
    // `perRegistrant` (N sessions, one browser) CANNOT redirect, so it MAILS each
    // registrant their own `url` and redirects to a "links sent" toast. When NO
    // chargeable session is minted (no party / unpriced / zero amount) the
    // submission falls through to the legacy persist→notify→success-redirect below.
    if (
      Option.isSome(env.stripe) &&
      'party' in shell &&
      definition.pricing !== undefined
    ) {
      const party = shell.party;
      const currency = env.stripe.value.currency;
      // Absolute, lang-aware return URLs derived from THIS request's URL (the
      // pathname already carries the `:lang?` prefix, e.g. `/fr/2026/form`). On
      // completion Stripe returns the visitor to the form with `?checkout=success`
      // (the form shows the honest "payment received — check your email" state); on
      // cancel, `?checkout=cancelled` returns them to the form to retry.
      const successUrl = `${url.origin}${url.pathname}?checkout=success`;
      const cancelUrl = `${url.origin}${url.pathname}?checkout=cancelled`;
      // The line-item product name on the hosted page — the form's localized title
      // (picked for THIS request's locale) is the closest human label the
      // definition carries.
      const productName = definition.title[getLocale(params)];
      // The locale for THIS request — drives the perRegistrant payment-link mail
      // copy below (group routes its receipt through Stripe, not this mail).
      const locale = getLocale(params);
      // The ONE group session url minted this submission (group mints exactly one);
      // we redirect the visitor to it so they begin paying. perRegistrant never
      // sets this — it cannot redirect (N sessions, one browser), it mails instead.
      let groupSessionUrl: string | undefined;
      // The perRegistrant payment links minted this submission, one per registrant
      // session. After the loop persists every session+order `pending`, each
      // registrant is MAILED their own hosted `url` (round-2 --deep BLOCKER:
      // redirecting to only the first stranded registrants 2..N forever). Each
      // order reconciles independently off its own `checkout.session.completed`.
      const paymentLinks: Array<{ submission: Submission; url: string }> = [];
      // ONE `now` for the whole submission (Decision 6) — every frozen amount in
      // this checkout reads the same instant, so a window boundary cannot split a
      // single submit across two prices.
      const now = yield* Clock.currentTimeMillis;
      if (party._tag === 'group') {
        // The party sum, frozen under the shared `now` (Decision 6) — the amount
        // the order records and the session charges. `priceGroup` sums each
        // registrant's price over the present `pricing` dimension (the gate above
        // already proved `pricing` is present — an UNPRICED form never reaches here).
        const amount = priceGroup(definition, shell.registrants, now);
        // A zero party sum (e.g. a fully-discounted window or a priced form where
        // nothing chargeable is selected) mints NO session/order — Stripe rejects
        // zero-amount line items and there is nothing to collect. The submission
        // still persists + notifies + redirects.
        if (amount > 0) {
          // The receipt routes to the NOMINATED payer (possibly a non-attendee),
          // frozen here so a later edit cannot retro-redirect the receipt (2b.6).
          const receiptEmail = party.payer.email;
          // One Checkout Session per party, keyed off the request fingerprint + mode
          // (Decision 2): a verbatim retry re-derives the same key ⇒ Stripe replays
          // the first session (no second checkout); a changed payload ⇒ a new one.
          const idempotencyKey = `registration:checkout:${requestFingerprint}:group`;
          const session = yield* payment.createCheckoutSession({
            amount,
            currency,
            receiptEmail,
            productName,
            successUrl,
            cancelUrl,
            metadata: { orderId: requestFingerprint, mode: 'group' },
            idempotencyKey,
          });
          groupSessionUrl = session.url;
          // Freeze the order record (Decision 7 step 3) — ONE order keyed by the
          // fingerprint, `registrantIds` = the whole party, amount + receiptEmail
          // frozen, `sessionId` = the Checkout Session. The webhook (C8) reads it
          // back to mark it `paid`.
          const order: RegistrationOrder = {
            orderId: requestFingerprint,
            mode: 'group',
            sessionId: session.sessionId,
            amount,
            currency,
            receiptEmail,
            status: 'pending',
            registrantIds: stored.map((registrant) => registrant.id),
          };
          yield* submissions.persistOrder('registration', order);
          // Anchor the durable Order entity at `pending` (G7.1) — fire-and-forget
          // after the freeze, gated on `Env.database` Some, never blocking the
          // redirect.
          yield* armOrder(order);
          // Stamp each party registrant `pending` on its OWN submission envelope
          // (plan :695) so a registrant record carries its payment lifecycle, not
          // just the order. The webhook (C8) flips these to `paid`/`failed` in
          // lock-step. Frozen mode/amount/currency mirror the order.
          for (const id of order.registrantIds) {
            yield* submissions.setRegistrantPayment('registration', id, {
              _tag: 'pending',
              orderId: order.orderId,
              mode: order.mode,
              amount: order.amount,
              currency: order.currency,
            });
          }
        }
      } else {
        // `perRegistrant`: one order + one session PER registrant (Decision 2b.6).
        // Each is keyed `<fingerprint>:<index>` so a verbatim retry replays the
        // SAME per-registrant sessions (no second checkout), and the receipt routes
        // to that registrant's OWN email (re-imposed present by the shell). The
        // per-registrant order links the ONE registrant submission it pays for.
        for (const [index, registrant] of shell.registrants.entries()) {
          const amount = priceRegistrant(definition, registrant, now);
          // A zero registrant price mints NO session/order for THAT registrant (the
          // others in the party still mint theirs) — Stripe rejects zero-amount
          // line items and there is nothing to collect.
          if (amount <= 0) continue;
          const receiptEmail = registrant['email'] as string;
          const orderId = `${requestFingerprint}:${index}`;
          const idempotencyKey = `registration:checkout:${requestFingerprint}:perRegistrant:${index}`;
          const session = yield* payment.createCheckoutSession({
            amount,
            currency,
            receiptEmail,
            productName,
            successUrl,
            cancelUrl,
            metadata: { orderId, mode: 'perRegistrant' },
            idempotencyKey,
          });
          // Pair THIS session's hosted url with the registrant it pays for, so the
          // post-loop fan-out mails each registrant their own link (not a redirect).
          paymentLinks.push({ submission: stored[index]!, url: session.url });
          const order: RegistrationOrder = {
            orderId,
            mode: 'perRegistrant',
            sessionId: session.sessionId,
            amount,
            currency,
            receiptEmail,
            status: 'pending',
            registrantIds: [stored[index]!.id],
          };
          yield* submissions.persistOrder('registration', order);
          // Anchor the durable Order entity for THIS perRegistrant order (G7.1) —
          // one `arm` send per minted order (N per request), each keyed by its
          // own `<fingerprint>:<index>` orderId.
          yield* armOrder(order);
          // Stamp THIS registrant `pending` on its own submission envelope (plan
          // :695) — one registrant per perRegistrant order. The webhook flips it
          // `paid`/`failed` in lock-step.
          yield* submissions.setRegistrantPayment(
            'registration',
            stored[index]!.id,
            {
              _tag: 'pending',
              orderId: order.orderId,
              mode: order.mode,
              amount: order.amount,
              currency: order.currency,
            },
          );
        }
      }

      // The post-session handoff is mode-branched (round-2 --deep BLOCKER):
      //
      //   group  ⇒ exactly ONE session was minted; hand the browser off to its
      //            hosted Stripe Checkout page (303 See Other — a POST action
      //            redirecting to a GET) so the visitor actually pays. The order
      //            stays `pending`; the paid status + receipt are owned by the
      //            `checkout.session.completed` webhook (C8).
      //
      //   perRegistrant ⇒ N sessions were minted, one per registrant — a single
      //            browser can only begin ONE, so redirecting to the first stranded
      //            registrants 2..N `pending` forever (their links hidden). Instead
      //            we MAIL each registrant their OWN hosted `url` (reusing the same
      //            `Mailer` boundary `notify` uses) and redirect to an HONEST
      //            "payment links sent — check your email" toast. Nothing is paid;
      //            each order reconciles independently on its own webhook. The
      //            sessions+orders are already durable + `pending`, so a mail
      //            failure surfaces a form error WITHOUT losing them
      //            (persist-then-notify, :56).
      if (groupSessionUrl !== undefined) {
        return yield* redirect(groupSessionUrl, { status: 303 });
      }
      if (paymentLinks.length > 0) {
        for (const link of paymentLinks) {
          yield* config.notifyPaymentLink({
            submission: link.submission,
            url: link.url,
            locale,
          });
        }
        return yield* toast.redirect(url.pathname, {
          title: config.perRegistrantSuccess.title,
          description: config.perRegistrantSuccess.description,
          type: 'success',
          form: 'registration',
        });
      }
      // Otherwise (every amount was zero) fall through to the legacy
      // persist→notify→success-redirect path below.
    }

    yield* config.notify(stored);

    yield* toast.redirect(url.pathname, {
      title: config.success.title,
      description: config.success.description,
      type: 'success',
      form: 'registration',
    });
    return { reset: true } satisfies FormSuccess;
  });

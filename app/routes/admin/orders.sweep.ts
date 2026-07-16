import { Effect, Option } from 'effect';
import { redirect } from 'react-router';

import { Auth } from '~/lib/auth.server';
import { Env } from '~/lib/env.server';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeAction } from '~/lib/effect/route';
import { OrderSweep } from '~/lib/order/sweep.server';

/**
 * The MANUAL deadline-sweep trigger (order-workflow G9, Open Question 5). A
 * POST-only resource route an operator (or an external cron, if GYC ever scales
 * past the single always-on instance the in-process sweep fiber assumes) hits to
 * run ONE sweep pass on demand — lapsing every pending order past its `deadline`
 * to `expired` via the durable `Order.expire` op, exactly as the in-process
 * fiber (`sweep.server.ts`) does on its schedule.
 *
 * It sits OUTSIDE the `/admin` guard LAYOUT (it is a non-rendering POST endpoint,
 * a sibling of the Stripe webhook), so it does its OWN cookie check rather than
 * inheriting the layout loader's: an admin-disabled deploy (`ADMIN_PASSWORD`
 * unset) 404s the endpoint (the sweep is not reachable without an admin), and a
 * missing/invalid cookie redirects to `/admin/login` — the same redirect-vs-404
 * policy the layout guard enforces. Gated additionally on `Env.database` Some:
 * a DB-less deploy has no Order runner to consume the `expire` sends, so the
 * trigger is a 404 (the durable lifecycle does not exist there).
 *
 * Returns the count of orders it dispatched `expire` for — JSON for an external
 * caller, observable in the operator's network tab. The `expire` sends are
 * fire-and-forget into the SAME SQL mailbox the `ServerLive` runner consumes
 * (the durable seam); the runner reconciles each flip off the persisted send.
 */
export const action = routeAction(function* () {
  const { request } = yield* ReactRouterContext;
  const auth = yield* Auth.Service;
  const env = yield* Env.Service;

  // Gate (parity with the `/admin` layout guard): admin disabled ⇒ 404 the
  // endpoint; no valid cookie ⇒ redirect to the login page. A DB-less deploy has
  // no runner to consume the sweep's `expire` sends, so the durable lifecycle —
  // and this trigger — does not exist: 404.
  yield* auth.checkCookie(request.headers.get('cookie')).pipe(
    Effect.catchTags({
      'Auth.Disabled': () =>
        Effect.fail(new Response('Not Found', { status: 404 })),
      'Auth.Unauthorized': () => Effect.fail(redirect('/admin/login')),
    }),
  );
  if (Option.isNone(env.database)) {
    return yield* Effect.fail(new Response('Not Found', { status: 404 }));
  }

  const expired = yield* OrderSweep.runOnce;
  return Response.json({ expired: expired.length, orderIds: expired });
});

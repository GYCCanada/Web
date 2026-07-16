import { Clock, Effect } from 'effect';

import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeAction } from '~/lib/effect/route';
import { processStripeWebhook } from '~/lib/registration/stripe-webhook.server';

/** Stripe must retry transient runtime/enqueue failures, but not bad signatures. */
export const action = routeAction(function* () {
  const { request } = yield* ReactRouterContext;
  const receivedAt = yield* Clock.currentTimeMillis;
  return yield* processStripeWebhook(request, receivedAt).pipe(
    Effect.match({
      onSuccess: () => new Response(null, { status: 204 }),
      onFailure: (error) =>
        new Response(
          error._tag === 'StripeWebhook.Rejected'
            ? 'Invalid Stripe webhook'
            : 'Stripe webhook temporarily unavailable',
          { status: error._tag === 'StripeWebhook.Rejected' ? 400 : 503 },
        ),
    }),
  );
});

export const loader = (): Response =>
  new Response('Method Not Allowed', { status: 405 });

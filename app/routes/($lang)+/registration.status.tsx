import { Effect, Option, Schema } from 'effect';
import { Link, useLoaderData } from 'react-router';

import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeHandler } from '~/lib/effect/route';
import { OrderId } from '~/lib/registration/order-repository.server';
import { RegistrationOrders } from '~/lib/registration/order-service.server';
import { RegistrationId } from '~/lib/registration/intake.server';

const decodeOrderId = Schema.decodeUnknownOption(OrderId);
const decodeRegistrationId = Schema.decodeUnknownOption(RegistrationId);

export const loader = routeHandler(function* () {
  const { request } = yield* ReactRouterContext;
  const url = new URL(request.url);
  const order = decodeOrderId(url.searchParams.get('order'));
  const registration = decodeRegistrationId(url.searchParams.get('registration'));
  const sessionId = url.searchParams.get('session_id');
  const orders = yield* RegistrationOrders.Service;

  if (
    Option.isNone(order) &&
    Option.isNone(registration) &&
    (sessionId === null || sessionId.length === 0)
  ) {
    return yield* Effect.fail(
      new Response('An Order or Checkout session is required.', { status: 400 }),
    );
  }

  const statuses = yield* (
    Option.isSome(registration)
      ? orders.byRegistration(registration.value)
      : Option.isSome(order)
        ? orders.byOrder(order.value).pipe(Effect.map((status) => [status]))
        : orders.byCheckoutSession(sessionId ?? '').pipe(
            Effect.map((status) => [status]),
          )
  ).pipe(
    Effect.catchTag('RegistrationOrders.NotFound', () =>
      Effect.fail(new Response('Registration Order not found.', { status: 404 })),
    ),
  );
  return statuses;
});

const statusCopy = {
  preparing_checkout: 'Preparing secure checkout',
  awaiting_payment: 'Ready for payment',
  awaiting_async: 'Payment processing',
  confirmed: 'Registration confirmed',
  failed: 'Payment failed',
  expired: 'Checkout expired',
  refund_pending: 'Refund processing',
  refund_failed: 'Refund needs review',
  refunded: 'Refunded',
} as const;

export default function RegistrationStatus() {
  const statuses = useLoaderData<typeof loader>();
  const preparing = statuses.some((status) => status.status === 'preparing_checkout');
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-16">
      {preparing ? <meta httpEquiv="refresh" content="2" /> : null}
      <p className="text-sm font-medium uppercase tracking-wide text-red-700">
        Registration
      </p>
      <h1 className="text-3xl font-semibold">Registration status</h1>
      <div className="space-y-4">
        {statuses.map((status, index) => (
          <section key={status.orderId} className="space-y-2 rounded-md border border-neutral-200 p-4">
            <h2 className="font-semibold">
              {statuses.length > 1 ? `Payment ${index + 1}: ` : ''}{statusCopy[status.status]}
            </h2>
            <p className="text-neutral-700">
              {status.registrantCount} {status.registrantCount === 1 ? 'registrant' : 'registrants'} ·{' '}
              {(status.amount / 100).toLocaleString('en-CA', { style: 'currency', currency: status.currency })}
            </p>
            {status.checkoutUrl !== undefined && status.status === 'awaiting_payment' ? (
              <a className="inline-flex rounded bg-red-700 px-5 py-3 font-semibold text-white hover:bg-red-800" href={status.checkoutUrl}>
                Continue to secure checkout
              </a>
            ) : null}
            {status.status === 'preparing_checkout' ? <p className="text-sm text-neutral-600">Checkout is being prepared. This page refreshes automatically.</p> : null}
          </section>
        ))}
      </div>
      <Link className="text-sm text-red-700 underline" to="/">
        Return home
      </Link>
    </main>
  );
}

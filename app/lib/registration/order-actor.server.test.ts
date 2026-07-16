import { describe, expect, it } from 'effect-bun-test';
import { Effect, Fiber, Layer, Option } from 'effect';
import { TestClock } from 'effect/testing';
import * as ShardingConfig from 'effect/unstable/cluster/ShardingConfig';

import { Cents } from '../forms/pricing';
import { OrderActor } from './order-actor.server';
import {
  type ApplyCommand,
  type ApplyResult,
  OrderId,
  OrderRepository,
  StripeEventId,
} from './order-repository.server';
import {
  type OrderState,
  transitionOrder,
} from './order-transition';
import {
  type Client,
  makeLayer as stripeLayer,
} from './stripe-gateway.server';

const orderId = OrderId.make('order-actor-1');

const harness = (
  initial: OrderState,
  client: Client,
) => {
  let state = initial;
  const events: ApplyCommand[] = [];
  const repository = OrderRepository.Service.of({
    checkout: () =>
      Effect.succeed({
        orderId,
        registrationId: 'registration-1',
        amount: Cents.make(5_000),
        receiptEmail: 'payer@example.com',
        idempotencyKey: 'checkout-order-actor-1',
        quoteExpiresAt: Date.now() + 60 * 60_000,
      }),
    apply: (command): Effect.Effect<ApplyResult> => {
      events.push(command);
      const transition = transitionOrder(state, command.event);
      state = transition.state;
      return Effect.succeed({ _tag: 'Applied', transition });
    },
  });
  const dependencies = Layer.mergeAll(
    Layer.succeed(OrderRepository.Service, repository),
    stripeLayer(Option.some(client)),
  );
  const layer = OrderActor.testHandlers.pipe(
    Layer.provideMerge(dependencies),
    Layer.provideMerge(ShardingConfig.layerDefaults),
  );
  return { events, layer, state: () => state };
};

describe('Registration Order actor', () => {
  it.effect('creates Checkout then records the hosted session through the repository', () => {
    const checkoutCalls: unknown[] = [];
    const client: Client = {
      createCheckout: (input, options) => {
        checkoutCalls.push({ input, options });
        return Effect.succeed({
          id: 'cs_actor',
          url: 'https://checkout.stripe.test/cs_actor',
        });
      },
      refund: () => Effect.die('unused'),
      constructEvent: () => Effect.die('unused'),
    };
    const test = harness(
      { status: 'preparing_checkout', amount: Cents.make(5_000) },
      client,
    );
    return Effect.gen(function* () {
      const execution = yield* OrderActor.Order.CreateCheckout.execute({ orderId }).pipe(
        Effect.forkChild,
      );
      yield* TestClock.adjust('1 minute');
      yield* Fiber.join(execution);
      expect(checkoutCalls).toHaveLength(1);
      expect(test.state().status).toBe('awaiting_payment');
      expect(test.state().stripeCheckoutSessionId).toBe('cs_actor');
      expect(test.events.map((command) => command.event._tag)).toEqual([
        'CheckoutCreated',
      ]);
    }).pipe(Effect.provide(test.layer));
  });

  it.effect('retries Checkout transport before recording terminal failure', () => {
    let attempts = 0;
    const client: Client = {
      createCheckout: () => {
        attempts += 1;
        return Effect.fail('Stripe unavailable');
      },
      refund: () => Effect.die('unused'),
      constructEvent: () => Effect.die('unused'),
    };
    const test = harness(
      { status: 'preparing_checkout', amount: Cents.make(5_000) },
      client,
    );
    return Effect.gen(function* () {
      const execution = yield* OrderActor.Order.CreateCheckout.execute({ orderId }).pipe(
        Effect.forkChild,
      );
      yield* TestClock.adjust('1 minute');
      yield* Fiber.join(execution);
      expect(attempts).toBe(6);
      expect(test.state().status).toBe('failed');
      expect(test.events.map((command) => command.event._tag)).toEqual([
        'CheckoutCreationFailed',
      ]);
    }).pipe(Effect.provide(test.layer));
  });

  it.effect('cancels registrants at refund initiation and records terminal success', () => {
    const refundCalls: unknown[] = [];
    const client: Client = {
      createCheckout: () => Effect.die('unused'),
      refund: (input, options) => {
        refundCalls.push({ input, options });
        return Effect.succeed({ id: 're_actor', status: 'succeeded' });
      },
      constructEvent: () => Effect.die('unused'),
    };
    const test = harness(
      {
        status: 'confirmed',
        amount: Cents.make(5_000),
        confirmedAt: 1,
        stripePaymentIntentId: 'pi_actor',
      },
      client,
    );
    return Effect.gen(function* () {
      yield* OrderActor.Order.Refund.execute({
        orderId,
        attemptId: 'attempt-1',
        at: 100,
      });
      expect(refundCalls).toHaveLength(1);
      expect(refundCalls).toEqual([
        {
          input: {
            payment_intent: 'pi_actor',
            reason: 'requested_by_customer',
            metadata: { orderId: 'order-actor-1' },
          },
          options: {
            idempotencyKey: 'registration:refund:order-actor-1',
          },
        },
      ]);
      expect(test.state().status).toBe('refunded');
      expect(test.events.map((command) => command.event._tag)).toEqual([
        'RefundRequested',
        'RefundSucceeded',
      ]);
      expect(
        transitionOrder(
          {
            status: 'confirmed',
            amount: Cents.make(5_000),
            confirmedAt: 1,
          },
          { _tag: 'RefundRequested', at: 100 },
        ).registrants,
      ).toBe('cancel');
    }).pipe(Effect.provide(test.layer));
  });

  it.effect('retries refund transport before opening operator review', () => {
    let attempts = 0;
    const client: Client = {
      createCheckout: () => Effect.die('unused'),
      refund: () => {
        attempts += 1;
        return Effect.fail('Stripe unavailable');
      },
      constructEvent: () => Effect.die('unused'),
    };
    const test = harness(
      {
        status: 'confirmed',
        amount: Cents.make(5_000),
        confirmedAt: 1,
        stripePaymentIntentId: 'pi_actor',
      },
      client,
    );
    return Effect.gen(function* () {
      const execution = yield* OrderActor.Order.Refund.execute({
        orderId,
        attemptId: 'attempt-1',
        at: 100,
      }).pipe(Effect.forkChild);
      yield* TestClock.adjust('1 minute');
      yield* Fiber.join(execution);
      expect(attempts).toBe(6);
      expect(test.state().status).toBe('refund_failed');
      expect(test.events.map((command) => command.event._tag)).toEqual([
        'RefundRequested',
        'RefundFailed',
      ]);
    }).pipe(Effect.provide(test.layer));
  });

  it.effect('resumes a refund already persisted as pending after a worker crash', () => {
    const refundCalls: unknown[] = [];
    const client: Client = {
      createCheckout: () => Effect.die('unused'),
      refund: (input, options) => {
        refundCalls.push({ input, options });
        return Effect.succeed({ id: 're_resumed', status: 'succeeded' });
      },
      constructEvent: () => Effect.die('unused'),
    };
    const test = harness(
      {
        status: 'refund_pending',
        amount: Cents.make(5_000),
        confirmedAt: 1,
        refundStartedAt: 100,
        stripePaymentIntentId: 'pi_actor',
      },
      client,
    );
    return Effect.gen(function* () {
      yield* OrderActor.Order.Refund.execute({
        orderId,
        attemptId: 'attempt-1',
        at: 100,
      });
      expect(refundCalls).toHaveLength(1);
      expect(test.state().status).toBe('refunded');
      expect(test.events.map((command) => command.event._tag)).toEqual([
        'RefundRequested',
        'RefundSucceeded',
      ]);
    }).pipe(Effect.provide(test.layer));
  });

  it.effect('keys Stripe operations by event id within the Order entity', () =>
    Effect.gen(function* () {
      const base = {
        orderId,
        stripeEventId: StripeEventId.make('evt_actor'),
        stripeEventType: 'checkout.session.completed',
      };
      const first = yield* OrderActor.Order.ApplyStripeEvent.executionId({
        ...base,
        event: {
          _tag: 'CheckoutCompleted',
          at: 1,
          paymentStatus: 'paid',
          amountTotal: Cents.make(5_000),
        },
      });
      const replay = yield* OrderActor.Order.ApplyStripeEvent.executionId({
        ...base,
        event: { _tag: 'CheckoutExpired', at: 2 },
      });
      expect(String(first)).toBe(String(replay));
      expect(String(first)).toContain('evt_actor');
    }),
  );
});

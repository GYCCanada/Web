import { DateTime, Effect, Result, Schema } from 'effect';
import type { ReactNode } from 'react';
import { Form, useActionData, useLoaderData, useNavigation } from 'react-router';

import { requireAdminRequest } from '~/lib/admin-auth.server';
import {
  adminFlashStatus,
  adminMeta,
  adminRedirectWithStatus,
  adminSecurityHeaders,
} from '~/lib/admin-headers';
import { ConferenceSlug, ExternalHttpsUrl } from '~/lib/content/schema';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeAction, routeHandler } from '~/lib/effect/route';
import { Forms } from '~/lib/forms/forms.server';
import { OrderId } from '~/lib/registration/order-repository.server';
import { RegistrationOrders } from '~/lib/registration/order-service.server';
import { Registrar } from '~/lib/registration/registrar.server';
import { StripeGateway } from '~/lib/registration/stripe-gateway.server';

export const meta = adminMeta;
export const headers = adminSecurityHeaders;

const conference = ConferenceSlug.make('/2026');
const decodeRevision = Schema.decodeUnknownResult(
  Schema.NumberFromString.pipe(Schema.check(Schema.isInt())),
);
const decodeExternalUrl = Schema.decodeUnknownResult(ExternalHttpsUrl);
const decodeTimeZone = Schema.decodeUnknownResult(Registrar.ConferenceTimeZone);
const decodeOrderId = Schema.decodeUnknownResult(OrderId);

type ActionResponse = {
  readonly ok: false;
  readonly error: string;
  readonly issues: ReadonlyArray<string>;
};

const failure = (
  status: number,
  error: string,
  issues: ReadonlyArray<string> = [],
): Response => Response.json({ ok: false, error, issues } satisfies ActionResponse, { status });

export const loader = routeHandler(function* () {
  yield* requireAdminRequest();
  const { request } = yield* ReactRouterContext;
  const channel = yield* (yield* Registrar.Service).get(conference);
  const published = yield* (yield* Forms.Service).current('registration');
  const stripe = yield* StripeGateway.Service;
  const reviews = yield* (yield* RegistrationOrders.Service).openReviews;
  return {
    channel: {
      state: channel.state,
      revision: channel.revision,
      externalUrl: channel.state === 'external' ? channel.url : undefined,
      formVersion:
        channel.state === 'preview' || channel.state === 'open' || channel.state === 'draining'
          ? channel.formVersion
          : undefined,
      timeZone:
        channel.state === 'preview' || channel.state === 'open' || channel.state === 'draining'
          ? channel.timeZone
          : undefined,
    },
    publishedVersion: published.version,
    stripeAvailable: stripe.available,
    reviews,
    status: adminFlashStatus(request),
  };
});

const transitionFailure = (error: unknown): Response => {
  if (Registrar.ChannelNotReady.is(error)) {
    return failure(
      409,
      'First-party registration is not ready to open.',
      error.issues.map((issue) => issue.message),
    );
  }
  if (Registrar.ActiveOrders.is(error)) {
    return failure(409, `The channel still has ${error.count} active Orders.`);
  }
  if (Registrar.RevisionConflict.is(error)) {
    return failure(409, 'The registration channel changed. Reload before trying again.');
  }
  if (Registrar.InvalidTransition.is(error)) {
    return failure(409, `Cannot move registration from ${error.from} to ${error.to}.`);
  }
  return failure(500, 'The registration channel could not be updated.');
};

function completeTransition<E>(
  operation: Effect.Effect<Registrar.Channel, E>,
): Effect.Effect<Response> {
  return operation.pipe(
    Effect.match({
      onFailure: transitionFailure,
      onSuccess: (channel) =>
        adminRedirectWithStatus(
          '/admin/registration',
          `Registration channel is now ${channel.state}.`,
        ),
    }),
  );
}

export const action = routeAction(function* () {
  yield* requireAdminRequest();
  const { request } = yield* ReactRouterContext;
  const submitted = yield* Effect.promise(() => request.formData());
  const intent = submitted.get('intent');
  const revision = decodeRevision(submitted.get('revision'));
  if (Result.isFailure(revision)) return failure(400, 'The channel revision is invalid.');

  const registrar = yield* Registrar.Service;
  const common = { conference, expectedRevision: revision.success };
  switch (intent) {
    case 'external': {
      const url = decodeExternalUrl(submitted.get('externalUrl'));
      if (Result.isFailure(url)) return failure(400, 'Enter a valid HTTPS registration URL.');
      return yield* completeTransition(
        registrar.setExternal({ ...common, url: url.success }),
      );
    }
    case 'preview': {
      const timeZone = decodeTimeZone(submitted.get('timeZone'));
      if (Result.isFailure(timeZone)) return failure(400, 'Enter a valid IANA time zone.');
      return yield* completeTransition(
        registrar.setPreview({
          ...common,
          formVersion: Forms.FormDefinitionVersionId.make(
            String(submitted.get('formVersion') ?? ''),
          ),
          timeZone: timeZone.success,
        }),
      );
    }
    case 'open': {
      return yield* completeTransition(
        registrar.open({
          ...common,
          at: DateTime.makeUnsafe(Date.now()),
        }),
      );
    }
    case 'drain':
      return yield* completeTransition(registrar.beginDrain(common));
    case 'reopen':
      return yield* completeTransition(
        registrar.reopen({ ...common, at: DateTime.makeUnsafe(Date.now()) }),
      );
    case 'close':
      return yield* completeTransition(registrar.close(common));
    case 'refund': {
      const orderId = decodeOrderId(submitted.get('orderId'));
      if (Result.isFailure(orderId)) return failure(400, 'The Order id is invalid.');
      const result = yield* (yield* RegistrationOrders.Service)
        .requestRefund(orderId.success, Date.now())
        .pipe(Effect.result);
      return Result.isSuccess(result)
        ? adminRedirectWithStatus('/admin/registration', 'Full refund enqueued.')
        : failure(503, 'The refund could not be enqueued.');
    }
    default:
      return failure(400, 'Unknown registration action.');
  }
});

const Submit = ({ intent, children }: { intent: string; children: ReactNode }) => {
  const navigation = useNavigation();
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      disabled={navigation.state === 'submitting'}
      className="min-h-11 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
    >
      {children}
    </button>
  );
};

export default function RegistrationAdmin() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const { channel } = data;
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Registration launch</h1>
        <p className="text-neutral-600">
          The CMS channel is the feature flag. Deployments never change it.
        </p>
        <p className="text-sm">
          Current state: <strong>{channel.state}</strong> · revision {channel.revision}
        </p>
      </header>

      {data.status ? <p className="rounded bg-emerald-50 p-3 text-emerald-800">{data.status}</p> : null}
      {actionData ? (
        <div className="rounded bg-rose-50 p-3 text-rose-800">
          <strong>{actionData.error}</strong>
          {actionData.issues.map((issue) => <p key={issue}>{issue}</p>)}
        </div>
      ) : null}

      <section className="space-y-3 rounded-md border border-neutral-200 bg-white p-5">
        <h2 className="font-semibold">External registration</h2>
        <Form method="post" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="revision" value={channel.revision} />
          <label className="flex flex-1 flex-col gap-1 text-sm">
            HTTPS registration URL
            <input
              className="rounded border border-neutral-300 px-3 py-2"
              name="externalUrl"
              type="url"
              required
              defaultValue={channel.externalUrl ?? 'https://gyccanada.regfox.com/gyc-canada-2026-speak'}
            />
          </label>
          <Submit intent="external">Use external registration</Submit>
        </Form>
      </section>

      <section className="space-y-3 rounded-md border border-neutral-200 bg-white p-5">
        <h2 className="font-semibold">First-party registration</h2>
        <p className="text-sm text-neutral-600">
          Preview pins the currently published immutable Form. Opening additionally requires valid pricing and Stripe configuration.
        </p>
        <Form method="post" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="revision" value={channel.revision} />
          <input type="hidden" name="formVersion" value={data.publishedVersion} />
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Conference time zone
            <input
              className="rounded border border-neutral-300 px-3 py-2"
              name="timeZone"
              defaultValue={channel.timeZone ?? 'America/Toronto'}
              required
            />
          </label>
          <Submit intent="preview">Preview version {data.publishedVersion}</Submit>
        </Form>
        <div className="flex flex-wrap gap-3">
          {channel.state === 'preview' ? <Form method="post"><input type="hidden" name="revision" value={channel.revision} /><Submit intent="open">Open first-party registration</Submit></Form> : null}
          {channel.state === 'open' ? <Form method="post"><input type="hidden" name="revision" value={channel.revision} /><Submit intent="drain">Stop new registrations</Submit></Form> : null}
          {channel.state === 'draining' ? <><Form method="post"><input type="hidden" name="revision" value={channel.revision} /><Submit intent="reopen">Reopen</Submit></Form><Form method="post"><input type="hidden" name="revision" value={channel.revision} /><Submit intent="close">Close after drain</Submit></Form></> : null}
        </div>
        <p className="text-xs text-neutral-500">Stripe readiness: {data.stripeAvailable ? 'configured' : 'not configured'}</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Orders requiring review</h2>
        {data.reviews.length === 0 ? <p className="text-sm text-neutral-600">No open reviews.</p> : (
          <ul className="space-y-3">
            {data.reviews.map((review) => (
              <li key={review.id} className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm">
                <strong>{review.reason}</strong> · {review.orderId}<p>{review.detail}</p>
                <Form method="post" className="mt-3"><input type="hidden" name="revision" value={channel.revision} /><input type="hidden" name="orderId" value={review.orderId} /><Submit intent="refund">Enqueue full refund</Submit></Form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

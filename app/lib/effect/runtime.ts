import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect';

import { Env } from '~/lib/env.server';
import { Mailchimp, MailchimpDisabled, MailchimpError } from '~/lib/mailchimp.server';
import { Mailer, MailError } from '~/lib/mailer.server';

import { ReactRouterContext, type RouteArgs } from './router-context';

export type AppServices = Env | Mailer | Mailchimp;
export type AppError =
  | Response
  | MailError
  | MailchimpError
  | MailchimpDisabled;

const AppLayer = Layer.mergeAll(Mailer.layer, Mailchimp.layer).pipe(
  Layer.provideMerge(Env.layer),
);
const AppRuntime = ManagedRuntime.make(AppLayer);

const isResponse = (v: unknown): v is Response =>
  typeof v === 'object' && v !== null && v instanceof Response;

const reportServerError = (cause: Cause.Cause<unknown>): void => {
  Bun.stderr.write(`[gycc] Effect error: ${Cause.pretty(cause)}\n`);
};

const throwHttpError = (error: unknown): never => {
  if (isResponse(error)) throw error;

  reportServerError(Cause.die(error));
  throw new Response('Internal Server Error', { status: 500 });
};

const throwCauseError = (cause: Cause.Cause<unknown>): never => {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) throwHttpError(reason.error);
    if (Cause.isDieReason(reason) && isResponse(reason.defect)) throw reason.defect;
  }

  reportServerError(cause);
  throw new Response('Internal Server Error', { status: 500 });
};

export interface RequestRuntime {
  readonly run: <A, E, R extends AppServices | ReactRouterContext>(
    args: RouteArgs,
    effect: Effect.Effect<A, E, R>,
  ) => Promise<A>;
}

const runWithContext = <A, E, R extends AppServices | ReactRouterContext>(
  args: RouteArgs,
  effect: Effect.Effect<A, E, R>,
): Promise<A> => {
  const provided = effect.pipe(
    Effect.provideService(ReactRouterContext, args),
  ) as Effect.Effect<A, E, AppServices>;
  return AppRuntime.runPromiseExit(provided).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    return throwCauseError(exit.cause);
  });
};

export const makeRequestRuntime = (): RequestRuntime => ({
  run: runWithContext,
});

/**
 * Eagerly build the app layer graph (forcing {@link Env.layer}) so that in
 * `NODE_ENV=production` the required mail / mailchimp secrets are validated at
 * server startup rather than lazily on the first form submit (ADR 0004:
 * "prod still fails fast on missing mail/mailchimp secrets").
 *
 * Rejects with the underlying Config error if a required secret is missing.
 */
export const buildAppRuntime = (): Promise<void> => AppRuntime.context().then(() => undefined);

export const disposeAppRuntime = (): Promise<void> => AppRuntime.dispose();

import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect';

import { AdminDisabled, Auth, BadPassword, Unauthorized } from '~/lib/auth.server';
import { Content } from '~/lib/content.server';
import { Env } from '~/lib/env.server';
import { Mailchimp, MailchimpDisabled, MailchimpError } from '~/lib/mailchimp.server';
import { Mailer, MailError } from '~/lib/mailer.server';
import { Storage } from '~/lib/storage.server';

import { ReactRouterContext, type RouteArgs } from './router-context';

export type AppServices = Env | Mailer | Mailchimp | Content | Auth;
export type AppError =
  | Response
  | MailError
  | MailchimpError
  | MailchimpDisabled
  | AdminDisabled
  | Unauthorized
  | BadPassword;

// `Content` reads through `Storage` and falls back to bundled defaults when no
// bucket is configured (D3). `Storage.layerOptional` therefore never fails to
// build — bucket-less, it provides a disabled storage whose reads report
// `NotFound`, which `Content` recovers from — so the runtime boots identically
// with or without a bucket. `Storage` is provided *into* `Content` and not
// re-exported, so it is not an `AppServices` requirement routes must satisfy.
//
// `Auth` is likewise optional everywhere: with `ADMIN_PASSWORD` unset its layer
// builds a disabled instance (admin 404s), so it never fails to build either.
const AppLayer = Layer.mergeAll(
  Mailer.layer,
  Mailchimp.layer,
  Content.layer.pipe(Layer.provide(Storage.layerOptional)),
  Auth.layer,
).pipe(Layer.provideMerge(Env.layer));
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

import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect';
import { data, redirect } from 'react-router';

import { AdminDisabled, Auth, BadPassword, Unauthorized } from '~/lib/auth.server';
import { Content } from '~/lib/content.server';
import { Env } from '~/lib/env.server';
import { Mailchimp, MailchimpDisabled, MailchimpError } from '~/lib/mailchimp.server';
import { Mailer, MailError } from '~/lib/mailer.server';
import { NotFound, Storage, StorageError } from '~/lib/storage.server';
import { Toast } from '~/lib/toast.server';

import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  RedirectError,
  type HttpError,
} from './errors';
import { ReactRouterContext, type RouteArgs } from './router-context';

export type AppServices =
  | Env.Service
  | Mailer.Service
  | Mailchimp.Service
  | Content.Service
  | Auth.Service
  | Storage.Service
  | Toast;
export type AppError =
  | Response
  | HttpError
  | MailError
  | MailchimpError
  | MailchimpDisabled
  | AdminDisabled
  | Unauthorized
  | BadPassword
  | StorageError
  | NotFound;

// `Content.defaultLayer` wires the public read path: it is `Content.layer` with
// its `Storage` dependency pre-provided as `Storage.layerOptional` (the
// never-fails-to-build storage — bucket-less it reports `NotFound`, which the
// read path recovers to the bundled defaults, D3), leaving only `Env` open for
// the merge below to discharge.
//
// `Storage.layerOptional` is ALSO provided standalone here — a legit second
// consumer (the `/admin` editor's write path: save-draft / publish / image
// upload, plus any route that reads `Storage` directly). It is a separate
// instance from the one inside `Content.defaultLayer`; both point at the same
// bucket via `Env`, so there is no shared in-memory state to coordinate. The
// admin write surface is only *reachable* when `Auth` is enabled
// (`ADMIN_PASSWORD` + `COOKIE_SECRET` set), independent of the bucket; the
// editor still surfaces a `StorageError` when an admin is configured without a
// bucket, rather than silently dropping a save.
//
// `Auth` is likewise optional everywhere: with `ADMIN_PASSWORD` unset its layer
// builds a disabled instance (admin 404s), so it never fails to build either.
const AppLayer = Layer.mergeAll(
  Mailer.layer,
  Mailchimp.layer,
  Toast.layer,
  Content.defaultLayer,
  Storage.layerOptional,
  Auth.layer,
).pipe(Layer.provideMerge(Env.layer));
const AppRuntime = ManagedRuntime.make(AppLayer);

const isResponse = (v: unknown): v is Response =>
  typeof v === 'object' && v !== null && v instanceof Response;

const reportServerError = (cause: Cause.Cause<unknown>): void => {
  Bun.stderr.write(`[gycc] Effect error: ${Cause.pretty(cause)}\n`);
};

const throwHttpError = (error: unknown): never => {
  // Tagged HTTP errors map to the matching React Router response before the raw
  // `Response` passthrough.
  if (RedirectError.is(error)) {
    const url = typeof error.url === 'string' ? error.url : error.url.toString();
    throw redirect(url, error.init as ResponseInit | undefined);
  }
  if (NotFoundError.is(error)) throw data('Not Found', { status: 404 });
  if (BadRequestError.is(error)) {
    // `message` shadows `Error.prototype.message` (defaults to ''); treat the
    // empty string as "no message" and fall back.
    throw data(error.message || 'Bad Request', { status: 400 });
  }
  if (InternalServerError.is(error)) {
    throw data('Internal Server Error', { status: 500 });
  }

  // Raw `Response` passthrough (transition + root ErrorBoundary).
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

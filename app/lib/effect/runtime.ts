import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect';

import { AdminDisabled, Auth, BadPassword, Unauthorized } from '~/lib/auth.server';
import { Content } from '~/lib/content.server';
import { Env } from '~/lib/env.server';
import { Mailchimp, MailchimpDisabled, MailchimpError } from '~/lib/mailchimp.server';
import { Mailer, MailError } from '~/lib/mailer.server';
import { NotFound, Storage, StorageError } from '~/lib/storage.server';

import { ReactRouterContext, type RouteArgs } from './router-context';

export type AppServices = Env | Mailer | Mailchimp | Content | Auth | Storage;
export type AppError =
  | Response
  | MailError
  | MailchimpError
  | MailchimpDisabled
  | AdminDisabled
  | Unauthorized
  | BadPassword
  | StorageError
  | NotFound;

// `Storage.layerOptional` never fails to *build*: bucket-less it provides a
// disabled storage whose reads report `NotFound` and whose writes fail
// `StorageError`, so the runtime boots identically with or without a bucket
// (D3). It is provided once and shared by BOTH `Content` (the public read path,
// which recovers `NotFound` → bundled defaults) and the `/admin` editor (C5 —
// the write path: save-draft / publish / image upload). The admin write surface
// is only *reachable* when `Auth` is enabled (`ADMIN_PASSWORD` + `COOKIE_SECRET`
// set), independent of the bucket; the editor still surfaces a `StorageError`
// when an admin is configured without a bucket, rather than silently dropping a
// save.
//
// `Auth` is likewise optional everywhere: with `ADMIN_PASSWORD` unset its layer
// builds a disabled instance (admin 404s), so it never fails to build either.
const StorageLive = Storage.layerOptional;
const AppLayer = Layer.mergeAll(
  Mailer.layer,
  Mailchimp.layer,
  Content.layer.pipe(Layer.provide(StorageLive)),
  StorageLive,
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

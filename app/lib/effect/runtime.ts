import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect';
import { data, redirect } from 'react-router';

import { AdminDisabled, Auth, BadPassword, Unauthorized } from '~/lib/auth.server';
import { Content } from '~/lib/content.server';
import { DraftEditor } from '~/lib/content/draft-editor.server';
import { Submissions } from '~/lib/forms/submissions.server';
import { Env } from '~/lib/env.server';
import { Sendgrid, SendgridDisabled, SendgridError } from '~/lib/sendgrid.server';
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
  | Sendgrid.Service
  | Content.Service
  | DraftEditor.Service
  | Submissions.Service
  | Auth.Service
  | Storage.Service
  | Toast;
export type AppError =
  | Response
  | HttpError
  | MailError
  | SendgridError
  | SendgridDisabled
  | AdminDisabled
  | Unauthorized
  | BadPassword
  | StorageError
  | NotFound;

// `storageLayer` is the ONE `Storage` instance the whole app runtime shares. It
// is provided to `Content.layer` (NOT `Content.defaultLayer`, which would bake
// in its own separate `Storage.layerOptional`) AND merged into the base, so the
// public read path's `Content.getForm`/`getPage`, the `/admin` editor's
// reads/writes (`DraftEditor`), the form-action persist step (`Submissions`),
// and any route that reads `Storage` directly all resolve the SAME
// `Storage.Service` over the SAME bucket — there is genuinely no second instance
// to coordinate. Production passes `Storage.layerOptional` (bucket-less it reports
// `NotFound`, which the read path recovers to the bundled defaults, D3; writes
// fail `StorageError` rather than silently dropping). `Content.layer` exposes
// `Content` with only `Env` left open, discharged by the surrounding merge.
//
// The admin write surface is only *reachable* when `Auth` is enabled
// (`ADMIN_PASSWORD` + `COOKIE_SECRET` set), independent of the bucket; the
// editor still surfaces a `StorageError` when an admin is configured without a
// bucket, rather than silently dropping a save.
//
// `Auth` is likewise optional everywhere: with `ADMIN_PASSWORD` unset its layer
// builds a disabled instance (admin 404s), so it never fails to build either.
//
// `DraftEditor.layer` (the `/admin` editor's write pipeline) and
// `Submissions.layer` (the form-action persist step) are layered ON TOP of this
// base via `provideMerge`, so each consumes the SAME exposed `Content.Service`
// (DraftEditor's `publish` busts the very cache the public read serves from;
// Submissions reads each form's CMS-editable definition through it) and the SAME
// exposed `Storage.Service` the editor route reads/writes and the persisted
// `submissions/<form>/<id>.json` objects land in.
/**
 * Build the full app layer over a chosen `Storage` layer. Production uses
 * `Storage.layerOptional` (bucket-less it reports `NotFound`/`StorageError`,
 * never failing to build). A test can pass an in-memory `Storage` layer (the
 * `Map`-backed `layerTest`) so a code path that WRITES — the form-action
 * `Submissions.persist` step — can be exercised end-to-end through the real
 * request runtime, since a bucket-less write would otherwise fail. The single
 * `storageLayer` instance is shared by `Content`, `DraftEditor`, and
 * `Submissions`: a form seeded into the injected bucket is read back by
 * `Content.getForm` through that SAME bucket (no second instance to coordinate),
 * so the write path is faithfully exercisable end-to-end through this seam.
 */
export const makeAppLayer = (
  storageLayer: Layer.Layer<Storage.Service, never, Env.Service>,
) => {
  const baseLayer = Layer.mergeAll(
    Mailer.layer,
    Sendgrid.layer,
    Toast.layer,
    Content.layer,
    Auth.layer,
  ).pipe(Layer.provideMerge(storageLayer));
  return Layer.mergeAll(DraftEditor.layer, Submissions.layer).pipe(
    Layer.provideMerge(baseLayer),
    Layer.provideMerge(Env.layer),
  );
};

/** The fully-composed app layer (its error channel is `Env.layer`'s `ConfigError`). */
export type AppLayer = ReturnType<typeof makeAppLayer>;

const AppRuntime = ManagedRuntime.make(makeAppLayer(Storage.layerOptional));

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

/**
 * The runtime any `RequestRuntime` runs against — `AppRuntime` in production. Its
 * error channel is `Env.layer`'s `ConfigError` (the `Config` reads at layer
 * construction), surfaced when a required env var is missing.
 */
type AppManagedRuntime = ManagedRuntime.ManagedRuntime<
  Layer.Success<AppLayer>,
  Layer.Error<AppLayer>
>;

const runWithContext =
  (runtime: AppManagedRuntime) =>
  <A, E, R extends AppServices | ReactRouterContext>(
    args: RouteArgs,
    effect: Effect.Effect<A, E, R>,
  ): Promise<A> => {
    const provided = effect.pipe(
      Effect.provideService(ReactRouterContext, args),
    ) as Effect.Effect<A, E, AppServices>;
    return runtime.runPromiseExit(provided).then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      return throwCauseError(exit.cause);
    });
  };

/**
 * Build a {@link RequestRuntime} over a chosen app layer, sharing the runtime's
 * error → `Response` mapping. Production calls {@link makeRequestRuntime} (the
 * global `AppRuntime`); a test builds one over `makeAppLayer(layerTest(...))` so
 * a route/form action that writes (`Submissions.persist`) runs end-to-end against
 * an in-memory bucket through the real pipeline.
 */
export const makeRequestRuntimeFromLayer = (layer: AppLayer): RequestRuntime => ({
  run: runWithContext(ManagedRuntime.make(layer)),
});

export const makeRequestRuntime = (): RequestRuntime => ({
  run: runWithContext(AppRuntime),
});

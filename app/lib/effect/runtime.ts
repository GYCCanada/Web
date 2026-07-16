import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect';
import { data, redirect } from 'react-router';

import { AdminDisabled, Auth, BadPassword, Unauthorized } from '~/lib/auth.server';
import { Content } from '~/lib/content.server';
import { DraftEditor } from '~/lib/content/draft-editor.server';
import { Database } from '~/lib/database.server';
import type { DatabaseTest } from '~/lib/database.test-helper';
import { Env } from '~/lib/env.server';
import { Forms } from '~/lib/forms/forms.server';
import { FormNotifications } from '~/lib/form-notifications.server';
import { Sendgrid, SendgridDisabled, SendgridError } from '~/lib/sendgrid.server';
import { Mailer, MailError } from '~/lib/mailer.server';
import { NotificationDelivery } from '~/lib/notification-delivery.server';
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
  | Forms.Service
  | FormNotifications.Service
  | NotificationDelivery.Service
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

/**
 * Compose the application over explicit object-storage and relational adapters.
 * Content and DraftEditor share one Storage instance; Forms owns the supplied
 * database lifecycle. Tests substitute both adapters without changing callers.
 */
export const makeAppLayer = (
  storageLayer: Layer.Layer<Storage.Service, never, Env.Service>,
  databaseLayer: typeof Database.layer | typeof DatabaseTest.layer,
  mailerLayer: Layer.Layer<Mailer.Service, never, Env.Service> = Mailer.layer,
) => {
  const baseLayer = Layer.mergeAll(
    mailerLayer,
    Sendgrid.layer,
    Toast.layer,
    Content.layer,
    Auth.layer,
  ).pipe(Layer.provideMerge(storageLayer));
  const relationalLayer = Layer.mergeAll(
    Forms.layer,
    NotificationDelivery.layer,
  ).pipe(Layer.provideMerge(databaseLayer));
  const notificationLayer = FormNotifications.layer.pipe(
    Layer.provideMerge(relationalLayer),
    Layer.provideMerge(baseLayer),
  );
  return Layer.mergeAll(DraftEditor.layer, notificationLayer).pipe(
    Layer.provideMerge(baseLayer),
    Layer.provideMerge(Env.layer),
  );
};

/** The fully-composed app layer (its error channel is `Env.layer`'s `ConfigError`). */
export type AppLayer = ReturnType<typeof makeAppLayer>;

const AppRuntime = ManagedRuntime.make(
  makeAppLayer(Storage.layerOptional, Database.layer),
);

/** Build the shared app runtime and verify its migrated relational adapter. */
export const checkAppReady = (): Promise<void> =>
  AppRuntime.runPromise(
    Effect.gen(function* () {
      yield* (yield* Database.Service).ready;
    }),
  );

/** Drain all currently eligible durable Form notification intents. */
export const drainFormNotifications = (): Promise<number> =>
  AppRuntime.runPromise(
    Effect.gen(function* () {
      return yield* (yield* FormNotifications.Service).drain;
    }),
  );

/** Finalize the process-scoped application runtime during server shutdown. */
export const disposeAppRuntime = (): Promise<void> => AppRuntime.dispose();

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
  /** Release resources owned by a layer-derived runtime; production is process-scoped. */
  readonly dispose: () => Promise<void>;
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
 * global `AppRuntime`); a test builds one over `makeTestAppLayer(layerTest(...))`
 * so relational Form writes and object-backed content reads run end-to-end
 * through their real adapters.
 */
export const makeRequestRuntimeFromLayer = (layer: AppLayer): RequestRuntime => {
  const runtime = ManagedRuntime.make(layer);
  return {
    run: runWithContext(runtime),
    dispose: () => runtime.dispose(),
  };
};

export const makeRequestRuntime = (): RequestRuntime => ({
  run: runWithContext(AppRuntime),
  dispose: () => Promise.resolve(),
});

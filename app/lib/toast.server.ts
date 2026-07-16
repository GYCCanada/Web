import {
  Config,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from 'effect';
import { nanoid } from 'nanoid';
import { createCookieSessionStorage } from 'react-router';

import { redirect, type RedirectError } from './effect/errors';
import { combineHeaders } from './misc';

export const toastKey = 'toast';
export const toastCookieName = 'en_toast';

/** Flash-toast codec with decode-time defaults for stale cookie payloads. */
const ToastSchema = Schema.Struct({
  description: Schema.String,
  id: Schema.String.pipe(
    Schema.withDecodingDefaultKey(Effect.sync(() => nanoid())),
  ),
  title: Schema.optionalKey(Schema.String),
  type: Schema.Literals(['message', 'success', 'error']).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed('message' as const)),
  ),
  form: Schema.optionalKey(Schema.String),
});

export type ToastMessage = typeof ToastSchema.Type;
export type ToastInput = typeof ToastSchema.Encoded;

const decodeToast = Schema.decodeUnknownEffect(ToastSchema);
const encodeToast = Schema.encodeEffect(ToastSchema);

export interface ToastRead {
  readonly toast: ToastMessage | null;
  readonly headers: Headers | null;
}

/** Flash-cookie service. Cookie construction belongs to the configured layer. */
export class Toast extends Context.Service<
  Toast,
  {
    readonly get: (request: Request) => Effect.Effect<ToastRead>;
    readonly redirect: (
      url: string,
      toast: ToastInput,
      init?: ResponseInit,
    ) => Effect.Effect<never, RedirectError>;
  }
>()('gycc/lib/toast.server/Toast') {
  static layer = Layer.unwrap(
    Effect.gen(function* () {
      const nodeEnv = yield* Config.string('NODE_ENV').pipe(
        Config.withDefault('development'),
      );
      const isProduction = nodeEnv === 'production';
      const secret = isProduction
        ? yield* Config.nonEmptyString('TOAST_COOKIE_SECRET').pipe(
            Config.map(Redacted.make),
          )
        : yield* Config.redacted('TOAST_COOKIE_SECRET').pipe(
            Config.withDefault(Redacted.make('development-toast-secret')),
          );
      return makeToastLayer({
        secret: Redacted.value(secret),
        secure: isProduction,
      });
    }),
  );
}

/** Explicit constructor for isolated tests and composed runtimes. */
export function makeToastLayer(options: {
  readonly secret: string;
  readonly secure: boolean;
}) {
  const storage = createCookieSessionStorage({
    cookie: {
      name: toastCookieName,
      sameSite: 'lax',
      path: '/',
      httpOnly: true,
      secrets: [options.secret],
      secure: options.secure,
    },
  });

  const createHeaders = Effect.fn('Toast.createHeaders')(function* (
    toastInput: ToastInput,
  ) {
    const session = yield* Effect.promise(() => storage.getSession());
    const toast = yield* decodeToast(toastInput).pipe(Effect.orDie);
    const encoded = yield* encodeToast(toast).pipe(Effect.orDie);
    session.flash(toastKey, encoded);
    const cookie = yield* Effect.promise(() => storage.commitSession(session));
    return new Headers({ 'set-cookie': cookie });
  });

  return Layer.succeed(
    Toast,
    Toast.of({
      get: Effect.fn('Toast.get')(function* (request: Request) {
        const session = yield* Effect.promise(() =>
          storage.getSession(request.headers.get('cookie')),
        );
        const decoded = yield* decodeToast(session.get(toastKey)).pipe(
          Effect.option,
        );
        if (Option.isNone(decoded)) {
          return { toast: null, headers: null } satisfies ToastRead;
        }
        const setCookie = yield* Effect.promise(() =>
          storage.destroySession(session),
        );
        return {
          toast: decoded.value,
          headers: new Headers({ 'set-cookie': setCookie }),
        } satisfies ToastRead;
      }),
      redirect: Effect.fn('Toast.redirect')(function* (
        url: string,
        toast: ToastInput,
        init?: ResponseInit,
      ) {
        const headers = yield* createHeaders(toast);
        return yield* redirect(url, {
          ...init,
          headers: combineHeaders(init?.headers, headers),
        });
      }),
    }),
  );
}

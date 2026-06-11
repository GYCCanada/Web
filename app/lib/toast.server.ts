import { Context, Effect, Layer, Option, Schema } from 'effect';
import { nanoid } from 'nanoid';
import { createCookieSessionStorage } from 'react-router';

import { redirect, type RedirectError } from './effect/errors';
import { combineHeaders } from './misc';

export const toastKey = 'toast';

/**
 * Flash-toast codec. Modelled on the previous zod schema, with **decode-time**
 * defaults: zod's `.default()` fires during `parse`, so the Effect equivalent is
 * `Schema.withDecodingDefaultKey` (NOT `withConstructorDefault`, which only
 * applies at `.make`-time). `id` defaults to a fresh `nanoid()` and `type` to
 * `'message'` when those keys are absent from a (possibly stale) cookie payload.
 */
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

/** Decoded flash toast (id + type always present after defaults are applied). */
export type ToastMessage = typeof ToastSchema.Type;
/** Encoded toast input — id/type may be omitted (decode supplies defaults). */
export type ToastInput = typeof ToastSchema.Encoded;

const decodeToast = Schema.decodeUnknownEffect(ToastSchema);
const encodeToast = Schema.encodeEffect(ToastSchema);

export const toastSessionStorage = createCookieSessionStorage({
  cookie: {
    name: 'en_toast',
    sameSite: 'lax',
    path: '/',
    httpOnly: true,
    secrets: ['secret-key'],
    secure: Bun.env.NODE_ENV === 'production',
  },
});

/** Result of reading the flash toast, preserving the previous null-on-invalid contract. */
export interface ToastRead {
  readonly toast: ToastMessage | null;
  readonly headers: Headers | null;
}

/**
 * Build the `set-cookie` headers that flash `toastInput` onto the toast cookie.
 * The input is constructed in-process (always valid), so a decode failure is a
 * bug, not a recoverable error — `Effect.orDie` collapses the `SchemaError`
 * channel so callers only ever see the empty failure surface.
 */
const createToastHeaders = Effect.fn('Toast.createHeaders')(function* (
  toastInput: ToastInput,
) {
  const session = yield* Effect.promise(() => toastSessionStorage.getSession());
  // Decode applies defaults (id/type) + validates, then re-encode to the
  // persisted shape so the next read decodes back to the same toast.
  const toast = yield* decodeToast(toastInput).pipe(Effect.orDie);
  const encoded = yield* encodeToast(toast).pipe(Effect.orDie);
  session.flash(toastKey, encoded);
  const cookie = yield* Effect.promise(() =>
    toastSessionStorage.commitSession(session),
  );
  return new Headers({ 'set-cookie': cookie });
});

/**
 * Toast flash-cookie service. Owns reading/clearing the toast flash cookie and
 * issuing a toast-bearing redirect.
 *
 * `get` preserves the historical `{ toast, headers }` contract: a missing or
 * invalid payload yields `{ toast: null, headers: null }` (stale cookies never
 * 500); a valid payload yields the decoded toast plus a `set-cookie` header that
 * destroys the flash session. `redirect` fails with the C1 {@link RedirectError}
 * whose init merges the toast's `set-cookie` headers, so the runtime forwards
 * them to React Router's `redirect(url, init)`.
 */
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
  static layer = Layer.succeed(Toast, {
    get: Effect.fn('Toast.get')(function* (request: Request) {
      const session = yield* Effect.promise(() =>
        toastSessionStorage.getSession(request.headers.get('cookie')),
      );
      const decoded = yield* decodeToast(session.get(toastKey)).pipe(
        Effect.option,
      );
      if (Option.isNone(decoded)) {
        return { toast: null, headers: null } satisfies ToastRead;
      }
      const setCookie = yield* Effect.promise(() =>
        toastSessionStorage.destroySession(session),
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
      const headers = yield* createToastHeaders(toast);
      return yield* redirect(url, {
        ...init,
        headers: combineHeaders(init?.headers, headers),
      });
    }),
  });
}

import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Layer, Redacted } from 'effect';
import { createCookieSessionStorage } from 'react-router';

import {
  makeToastLayer,
  Toast,
  toastCookieName,
  toastKey,
  type ToastInput,
} from './toast.server';

const TEST_SECRET = 'toast-test-secret';
const testLayer = makeToastLayer({
  secret: Redacted.make(TEST_SECRET),
  secure: false,
});
const toastSessionStorage = createCookieSessionStorage({
  cookie: {
    name: toastCookieName,
    secrets: [TEST_SECRET],
  },
});

/**
 * Build a request whose cookie carries `payload` flashed under {@link toastKey},
 * exactly as the app writes it (`session.flash` + `commitSession`). `payload` is
 * intentionally loosely typed so tests can exercise stale / partial cookie
 * shapes the schema must tolerate.
 */
async function requestWithToastCookie(payload: unknown): Promise<Request> {
  const session = await toastSessionStorage.getSession();
  session.flash(toastKey, payload);
  const cookie = await toastSessionStorage.commitSession(session);
  return new Request('http://localhost/', { headers: { cookie } });
}

const getToast = (request: Request) =>
  Effect.gen(function* () {
    const toast = yield* Toast;
    return yield* toast.get(request);
  }).pipe(Effect.provide(testLayer), Effect.runPromise);

describe('Toast.get', () => {
  it('applies decode defaults for a partial payload (missing id + type)', async () => {
    const request = await requestWithToastCookie({
      description: 'main.newsletter.success.description',
      title: 'main.newsletter.success.title',
      form: 'newsletter-form',
    } satisfies ToastInput);

    const { toast, headers } = await getToast(request);

    expect(toast).not.toBeNull();
    expect(toast?.description).toBe('main.newsletter.success.description');
    expect(toast?.title).toBe('main.newsletter.success.title');
    expect(toast?.form).toBe('newsletter-form');
    // default-applied fields
    expect(toast?.type).toBe('message');
    expect(typeof toast?.id).toBe('string');
    expect((toast?.id ?? '').length).toBeGreaterThan(0);
    // valid payload → clears the flash cookie
    expect(headers?.get('set-cookie')).toBeTruthy();
  });

  it('preserves an explicit id + type from a complete payload', async () => {
    const request = await requestWithToastCookie({
      description: 'contact.form.success.description',
      id: 'fixed-id',
      type: 'success',
    } satisfies ToastInput);

    const { toast } = await getToast(request);

    expect(toast?.id).toBe('fixed-id');
    expect(toast?.type).toBe('success');
  });

  it('returns the null-on-invalid contract for a malformed payload', async () => {
    // `description` is required; a payload missing it is invalid.
    const request = await requestWithToastCookie({ title: 'orphan' });

    const { toast, headers } = await getToast(request);

    expect(toast).toBeNull();
    expect(headers).toBeNull();
  });

  it('returns the null-on-invalid contract when no toast cookie is present', async () => {
    const request = new Request('http://localhost/');

    const { toast, headers } = await getToast(request);

    expect(toast).toBeNull();
    expect(headers).toBeNull();
  });

  it('rejects a cookie signed with the removed repository-known secret', async () => {
    const oldStorage = createCookieSessionStorage({
      cookie: { name: toastCookieName, secrets: ['secret-key'] },
    });
    const session = await oldStorage.getSession();
    session.flash(toastKey, { description: 'forged' });
    const cookie = await oldStorage.commitSession(session);

    const { toast } = await getToast(
      new Request('http://localhost/', { headers: { cookie } }),
    );
    expect(toast).toBeNull();
  });

  it('requires TOAST_COOKIE_SECRET when constructing production layer', async () => {
    const config = ConfigProvider.layer(
      ConfigProvider.fromEnv({ env: { NODE_ENV: 'production' } }),
    );
    const exit = await Effect.runPromise(
      Effect.scoped(Layer.build(Toast.layer)).pipe(
        Effect.provide(config),
        Effect.exit,
      ),
    );
    expect(exit._tag).toBe('Failure');
  });

  it('rejects a blank TOAST_COOKIE_SECRET in production', async () => {
    const config = ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: { NODE_ENV: 'production', TOAST_COOKIE_SECRET: '   ' },
      }),
    );
    const exit = await Effect.runPromise(
      Effect.scoped(Layer.build(Toast.layer)).pipe(
        Effect.provide(config),
        Effect.exit,
      ),
    );
    expect(exit._tag).toBe('Failure');
  });
});

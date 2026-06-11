import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import { Toast, toastKey, toastSessionStorage, type ToastInput } from './toast.server';

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
  }).pipe(Effect.provide(Toast.layer), Effect.runPromise);

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
});

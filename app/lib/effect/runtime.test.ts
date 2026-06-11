import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { RouterContextProvider } from 'react-router';

import {
  BadRequestError,
  FormValidationError,
  InternalServerError,
  NotFoundError,
  RedirectError,
} from './errors';
import { makeRequestRuntime } from './runtime';
import type { RouteArgs } from './router-context';

const makeArgs = (url = 'http://localhost/test'): RouteArgs => ({
  request: new Request(url),
  url: new URL(url),
  pattern: '/test',
  params: {},
  context: new RouterContextProvider(),
});

const runtime = makeRequestRuntime();

/**
 * `runtime.run` rethrows the mapped error. Capture whatever it throws so the
 * tests can assert on the React Router response the runtime produced.
 */
const runThrown = async <E>(
  effect: Effect.Effect<unknown, E, never>,
): Promise<unknown> => {
  try {
    await runtime.run(makeArgs(), effect);
  } catch (thrown) {
    return thrown;
  }
  throw new Error('expected runtime.run to throw');
};

const isDataWithStatus = (
  value: unknown,
): value is { data: unknown; init: ResponseInit | null } =>
  typeof value === 'object' &&
  value !== null &&
  'data' in value &&
  'init' in value;

describe('runtime tagged-error mapping', () => {
  it('maps RedirectError to a redirect Response carrying init headers', async () => {
    const thrown = await runThrown(
      Effect.fail(
        new RedirectError({
          url: '/thanks',
          init: { headers: { 'set-cookie': 'en_toast=abc' } },
        }),
      ),
    );
    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/thanks');
    expect(response.headers.get('set-cookie')).toBe('en_toast=abc');
  });

  it('maps RedirectError with a URL instance', async () => {
    const thrown = await runThrown(
      Effect.fail(new RedirectError({ url: new URL('http://localhost/next') })),
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get('location')).toBe(
      'http://localhost/next',
    );
  });

  it('maps NotFoundError to a 404', async () => {
    const thrown = await runThrown(Effect.fail(new NotFoundError()));
    expect(isDataWithStatus(thrown)).toBe(true);
    if (isDataWithStatus(thrown)) {
      expect(thrown.init?.status).toBe(404);
    }
  });

  it('maps BadRequestError to a 400 carrying its message', async () => {
    const thrown = await runThrown(
      Effect.fail(new BadRequestError({ message: 'nope' })),
    );
    expect(isDataWithStatus(thrown)).toBe(true);
    if (isDataWithStatus(thrown)) {
      expect(thrown.init?.status).toBe(400);
      expect(thrown.data).toBe('nope');
    }
  });

  it('maps BadRequestError without a message to a 400 fallback', async () => {
    const thrown = await runThrown(Effect.fail(new BadRequestError({})));
    expect(isDataWithStatus(thrown)).toBe(true);
    if (isDataWithStatus(thrown)) {
      expect(thrown.init?.status).toBe(400);
      expect(thrown.data).toBe('Bad Request');
    }
  });

  it('maps InternalServerError to a 500', async () => {
    const thrown = await runThrown(Effect.fail(new InternalServerError()));
    expect(isDataWithStatus(thrown)).toBe(true);
    if (isDataWithStatus(thrown)) {
      expect(thrown.init?.status).toBe(500);
    }
  });

  it('passes a raw Response failure through unchanged', async () => {
    const response = new Response('teapot', { status: 418 });
    const thrown = await runThrown(Effect.fail(response));
    expect(thrown).toBe(response);
  });

  it('passes a raw Response defect through unchanged', async () => {
    const response = new Response('teapot', { status: 418 });
    const thrown = await runThrown(Effect.die(response));
    expect(thrown).toBe(response);
  });

  it('falls back to a 500 Response for an unmapped failure', async () => {
    // FormValidationError is deliberately not HTTP-mapped here — the form
    // pipeline (C3) reports it via conform, so reaching the runtime is a 500.
    const thrown = await runThrown(
      Effect.fail(new FormValidationError({ error: { formErrors: ['x'] } })),
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(500);
  });

  it('falls back to a 500 Response for an unknown defect', async () => {
    const thrown = await runThrown(Effect.die(new Error('boom')));
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(500);
  });
});

import { describe, expect, it } from 'bun:test';
import { RouterContextProvider } from 'react-router';

import { BadRequestError, formValidationError, redirect } from './errors';
import { routeFormAction, SubmissionContext, type FormSuccess } from './form';
import { HONEYPOT_FIELD } from '../honeypot';
import { makeRequestRuntime } from './runtime';
import type { RouteArgs } from './router-context';

/**
 * Build {@link RouteArgs} whose request carries `fields` as a form POST, with the
 * Effect request runtime attached to the router context (as the server does in
 * `server.ts`). This is what `routeFormAction` consumes.
 */
const makeFormArgs = (fields: Record<string, string>): RouteArgs => {
  const body = new URLSearchParams(fields);
  const url = 'http://localhost/test';
  const request = new Request(url, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const context = new RouterContextProvider();
  context.runtime = makeRequestRuntime();
  return {
    request,
    url: new URL(url),
    pattern: '/test',
    params: {},
    context,
  };
};

describe('routeFormAction', () => {
  it('reports success and resets when the body returns { reset: true }', async () => {
    const action = routeFormAction(function* () {
      // The submission is reachable from context — mirrors a real action.
      const submission = yield* SubmissionContext;
      expect(submission.payload['email']).toBe('ada@example.com');
      return { reset: true } satisfies FormSuccess;
    });

    const result = await action(makeFormArgs({ email: 'ada@example.com' }));

    expect(result.status).toBe('success');
    expect(result.result.reset).toBe(true);
    expect(result.result.error).toBeUndefined();
  });

  it('reports validation errors bucketed into form + field errors', async () => {
    const action = routeFormAction(function* () {
      yield* formValidationError({
        formErrors: ['contact.form.error'],
        fieldErrors: { email: ['volunteer.form.email.invalid'] },
      });
      return { reset: false } satisfies FormSuccess;
    });

    const result = await action(makeFormArgs({ email: 'nope' }));

    expect(result.status).toBe('error');
    expect(result.result.error?.formErrors).toEqual(['contact.form.error']);
    expect(result.result.error?.fieldErrors['email']).toEqual([
      'volunteer.form.email.invalid',
    ]);
  });

  it('propagates a RedirectError as a redirect Response (C1 mapping)', async () => {
    const action = routeFormAction(function* () {
      yield* redirect('/thanks', {
        headers: { 'set-cookie': 'en_toast=abc' },
      });
      return { reset: true } satisfies FormSuccess;
    });

    let thrown: unknown;
    try {
      await action(makeFormArgs({ email: 'ada@example.com' }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/thanks');
    expect(response.headers.get('set-cookie')).toBe('en_toast=abc');
  });

  it('maps a body BadRequestError to a form-level error report', async () => {
    const action = routeFormAction(function* () {
      yield* new BadRequestError({ message: 'too big' });
      return { reset: false } satisfies FormSuccess;
    });

    const result = await action(makeFormArgs({ email: 'ada@example.com' }));

    expect(result.status).toBe('error');
    expect(result.result.error?.formErrors).toEqual(['too big']);
  });

  it('returns silent success when the honeypot field is filled', async () => {
    let bodyRan = false;
    const action = routeFormAction(function* () {
      bodyRan = true;
      yield* formValidationError({ formErrors: ['should not run'] });
      return { reset: false } satisfies FormSuccess;
    });

    const result = await action(
      makeFormArgs({ email: 'ada@example.com', [HONEYPOT_FIELD]: 'https://spam.example' }),
    );

    expect(bodyRan).toBe(false);
    expect(result.status).toBe('success');
    expect(result.result.reset).toBe(true);
    expect(result.result.error).toBeUndefined();
  });

  it('runs the body when the honeypot field is empty', async () => {
    let bodyRan = false;
    const action = routeFormAction(function* () {
      bodyRan = true;
      return { reset: true } satisfies FormSuccess;
    });

    const result = await action(
      makeFormArgs({ email: 'ada@example.com', [HONEYPOT_FIELD]: '' }),
    );

    expect(bodyRan).toBe(true);
    expect(result.status).toBe('success');
    expect(result.result.reset).toBe(true);
  });
});

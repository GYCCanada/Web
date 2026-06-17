import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { RouterContextProvider } from 'react-router';

import { formValidationError } from '../effect/errors';
import { makeRequestRuntime } from '../effect/runtime';
import type { RouteArgs } from '../effect/router-context';

import { formAction } from './action';
import type { DecodedForm } from './decode';

/**
 * Branch 6.2 — the generic action skeleton.
 *
 * `formAction({ form, notify, success })` collapses the `parse → decode → notify
 * → toast.redirect` pipeline the three form routes triplicate into one wrapped
 * route action. These tests pin the pipeline WIRING (`prove-it-works`) — the
 * per-kind decode semantics are covered exhaustively in `decode.test.ts`, so here
 * the form's `FormDefinition` is the bundled default (empty field graph, so any
 * payload decodes), letting the test isolate the skeleton's own behaviour:
 *   - a valid submission runs `notify` with the decoded payload, then redirects
 *     with the success toast (so a migrated route's success path is unchanged);
 *   - a `notify` failure (e.g. a mailer error mapped to a form-level key) aborts
 *     the redirect and surfaces as a form error report — the record-vs-notify
 *     separation Branch 7 builds the persist step in front of;
 *   - the honeypot short-circuit (inherited from `routeFormAction`) skips the
 *     body entirely.
 *
 * The action runs through the real request runtime (`makeRequestRuntime`), which
 * wires `Content` (reading the bundled default form definition), `Toast`, and the
 * `Mailer` — the same layers the live server provides.
 */

const makeFormArgs = (fields: Record<string, string>): RouteArgs => {
  const body = new URLSearchParams(fields);
  const url = 'http://localhost/contact';
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
    pattern: '/contact',
    params: {},
    context,
  };
};

describe('formAction', () => {
  it('runs notify with the decoded payload, then redirects with the success toast', async () => {
    let notified: DecodedForm | undefined;
    const action = formAction({
      form: 'contact',
      notify: (decoded) =>
        Effect.sync(() => {
          notified = decoded;
        }),
      success: {
        title: 'contact.form.success.title',
        description: 'contact.form.success.description',
      },
    });

    let thrown: unknown;
    try {
      await action(makeFormArgs({ name: 'Ada' }));
    } catch (error) {
      thrown = error;
    }

    // The terminal toast.redirect fails with a RedirectError the runtime maps to
    // a redirect Response (the C1 mapping the contact/volunteer actions rely on).
    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/contact');
    // The success toast was flashed (the set-cookie carries the toast session).
    expect(response.headers.get('set-cookie')).toContain('toast');
    // notify ran with the decoded payload.
    expect(notified).toEqual({ name: 'Ada' });
  });

  it('a notify failure aborts the redirect and reports a form-level error', async () => {
    const action = formAction({
      form: 'contact',
      notify: () =>
        Effect.fail(formValidationError({ formErrors: ['contact.form.error'] })),
      success: {
        title: 'contact.form.success.title',
        description: 'contact.form.success.description',
      },
    });

    const result = await action(makeFormArgs({ name: 'Ada' }));

    expect(result.status).toBe('error');
    expect(result.result.error?.formErrors).toEqual(['contact.form.error']);
  });

  it('skips the body (no notify) when the honeypot is filled', async () => {
    let notifyRan = false;
    const action = formAction({
      form: 'contact',
      notify: () =>
        Effect.sync(() => {
          notifyRan = true;
        }),
      success: {
        title: 'contact.form.success.title',
        description: 'contact.form.success.description',
      },
    });

    const result = await action(
      makeFormArgs({ name: 'Ada', website: 'https://spam.example' }),
    );

    expect(notifyRan).toBe(false);
    expect(result.status).toBe('success');
  });
});

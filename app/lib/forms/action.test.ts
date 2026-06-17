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
 * the form is `contact` (its graph populated in 6.3) driven by a minimal VALID
 * contact payload. Every form now carries a populated graph (registration's
 * migrated in 6.5), so the skeleton is isolated with a payload that decodes rather
 * than the old empty-graph fixture. Each form is exercised end-to-end by its own
 * equivalence harness; here we pin only the skeleton's own wiring:
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
      await action(
        makeFormArgs({
          method: 'email',
          name: 'Ada',
          email: 'ada@example.com',
          message: 'hi',
        }),
      );
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
    expect(notified).toEqual({
      method: 'email',
      name: 'Ada',
      email: 'ada@example.com',
      message: 'hi',
    });
  });

  // BLOCKER 1 regression pin: contact's `email`/`phone` are `optional: true` and
  // the renderer GATES each on `method` (renders the active one only). So the real
  // rendered method=email payload OMITS `phone` — and that absence must decode to
  // success. The inverse (method=phone, no `email`) likewise. If the renderer ever
  // regressed to rendering both unconditionally, the browser would POST a present
  // BLANK (`phone=''`) for the inactive field, which the `optional: true` codec
  // rejects as `requiredMessage` — proven below. These submit through the REAL
  // `parseSubmission` (no `stripEmptyValues`), so a present `''` is kept, exactly
  // as the browser sends it.
  it('the rendered method=phone payload (email field absent) decodes to success', async () => {
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
      await action(
        makeFormArgs({
          method: 'phone',
          name: 'Ada',
          phone: '123-456-7890',
          message: 'hi',
        }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect(notified).toEqual({
      method: 'phone',
      name: 'Ada',
      phone: '123-456-7890',
      message: 'hi',
    });
  });

  it('a present-blank inactive field (the pre-fix unconditional render) FAILS — why the renderer must gate it', async () => {
    const action = formAction({
      form: 'contact',
      notify: () => Effect.void,
      success: {
        title: 'contact.form.success.title',
        description: 'contact.form.success.description',
      },
    });

    // The regression payload: method=email but the browser ALSO posted an empty
    // `phone` (the bug the renderer fix prevents). `parseSubmission` keeps the
    // present `''`, and the `optional: true` phone codec rejects a present blank.
    const result = await action(
      makeFormArgs({
        method: 'email',
        name: 'Ada',
        email: 'ada@example.com',
        phone: '',
        message: 'hi',
      }),
    );

    expect(result.status).toBe('error');
    expect(result.result.error?.fieldErrors?.['phone']).toEqual([
      'contact.form.phone.required',
    ]);
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

    const result = await action(
      makeFormArgs({
        method: 'email',
        name: 'Ada',
        email: 'ada@example.com',
        message: 'hi',
      }),
    );

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

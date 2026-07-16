import { describe, expect, it } from 'bun:test';
import { Effect, ManagedRuntime } from 'effect';
import { RouterContextProvider } from 'react-router';

import { Schema } from 'effect';

import { defaultContactPage } from '../content/pages/defaults';
import { pageObjectKey } from '../content/pages/registry';
import { ContactPage } from '../content/pages/schema';
import { formValidationError } from '../effect/errors';
import {
  makeRequestRuntimeFromLayer,
  makeTestAppLayer,
} from '../effect/runtime';
import type { RouteArgs } from '../effect/router-context';
import { layerTest } from '../storage.test-helper';

import { formAction } from './action';
import { Forms } from './forms.server';
import {
  FORM_VERSION_FIELD,
  IDEMPOTENCY_TOKEN_FIELD,
  newSubmissionCommandFields,
} from './submission-command';

/**
 * Branch 6.2 — the generic action skeleton; Branch 7.3 — persist-then-notify.
 *
 * `formAction({ form, notify, success })` collapses the `parse → decode → persist
 * → notify → toast.redirect` pipeline the form routes triplicate into one wrapped
 * route action. These tests pin the pipeline WIRING (`prove-it-works`) — the
 * per-kind decode semantics are covered exhaustively in `decode.test.ts` and the
 * durable-write contract in `submissions.server.test.ts`, so here the form is
 * `contact` driven by a minimal VALID contact payload. We pin only the skeleton's
 * own wiring:
 *   - a valid submission PERSISTS the durable record, then runs `notify` with the
 *     STORED `Submission` (Branch 7.3 — the email references the persisted record),
 *     then redirects with the success toast;
 *   - a `notify` failure (e.g. a mailer error mapped to a form-level key) aborts
 *     the redirect and surfaces as a form error report — and the record is ALREADY
 *     persisted (persist ran first), the record-vs-notify separation settled #8
 *     demands;
 *   - the honeypot short-circuit (inherited from `routeFormAction`) skips the
 *     body entirely (no persist, no notify).
 *
 * The action runs through the real request runtime, but over `makeAppLayer` with
 * an IN-MEMORY `Storage` (`layerTest`) so the `Submissions.persist` write
 * succeeds end-to-end — a bucket-less production `Storage.layerOptional` would
 * fail the write. `Content` (the bundled default form definition), `Toast`, and
 * the `Mailer` are the same layers the live server provides.
 */

const makeFormArgs = async (
  fields: Record<string, string>,
): Promise<RouteArgs> => {
  const appLayer = makeTestAppLayer(layerTest({}));
  const runtime = ManagedRuntime.make(appLayer);
  const published = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Forms.Service).current('contact');
    }),
  );
  const command = newSubmissionCommandFields(published.version);
  const body = new URLSearchParams({
    ...fields,
    [FORM_VERSION_FIELD]: command.definitionVersion,
    [IDEMPOTENCY_TOKEN_FIELD]: command.idempotencyToken,
  });
  const url = 'http://localhost/contact';
  const request = new Request(url, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const context = new RouterContextProvider();
  context.runtime = makeRequestRuntimeFromLayer(appLayer);
  return {
    request,
    url: new URL(url),
    pattern: '/contact',
    params: {},
    context,
  };
};

describe('formAction', () => {
  it('persists, runs notify with the stored record, then redirects with the success toast', async () => {
    let notified: Forms.Submission | undefined;
    const action = formAction({
      form: 'contact',
      page: 'contact',
      notify: (submission) =>
        Effect.sync(() => {
          notified = submission;
        }),
      success: {
        title: 'contact.form.success.title',
        description: 'contact.form.success.description',
      },
    });

    let thrown: unknown;
    try {
      await action(
        await makeFormArgs({
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
    // notify ran with the STORED record: a real branded id + form, and the
    // decoded payload as the source of truth the email references (Branch 7.3).
    expect(notified?.form).toBe('contact');
    expect(typeof notified?.id).toBe('string');
    expect(notified?.payload).toEqual({
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
    let notified: Forms.Submission | undefined;
    const action = formAction({
      form: 'contact',
      page: 'contact',
      notify: (submission) =>
        Effect.sync(() => {
          notified = submission;
        }),
      success: {
        title: 'contact.form.success.title',
        description: 'contact.form.success.description',
      },
    });

    let thrown: unknown;
    try {
      await action(
        await makeFormArgs({
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
    expect(notified?.payload).toEqual({
      method: 'phone',
      name: 'Ada',
      phone: '123-456-7890',
      message: 'hi',
    });
  });

  it('a present-blank inactive field (the pre-fix unconditional render) FAILS — why the renderer must gate it', async () => {
    const action = formAction({
      form: 'contact',
      page: 'contact',
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
      await makeFormArgs({
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
      page: 'contact',
      notify: () =>
        Effect.fail(formValidationError({ formErrors: ['contact.form.error'] })),
      success: {
        title: 'contact.form.success.title',
        description: 'contact.form.success.description',
      },
    });

    const result = await action(
      await makeFormArgs({
        method: 'email',
        name: 'Ada',
        email: 'ada@example.com',
        message: 'hi',
      }),
    );

    expect(result.status).toBe('error');
    expect(result.result.error?.formErrors).toEqual(['contact.form.error']);
    expect(
      Schema.is(Forms.FormDefinitionVersionId)(
        result.preserved[FORM_VERSION_FIELD],
      ),
    ).toBe(true);
    expect(
      Schema.is(Forms.IdempotencyToken)(
        result.preserved[IDEMPOTENCY_TOKEN_FIELD],
      ),
    ).toBe(true);
  });

  // Run a contact `formAction` whose owning page is seeded DISABLED, against the
  // given POST body. Returns the thrown 404 (a `DataWithResponseInit`) + whether
  // notify ran. The gate must 404 EVERY POST, including a honeypot-filled one, so
  // both bodies route through this helper.
  const runDisabledPagePost = async (
    body: Record<string, string>,
  ): Promise<{ thrown: unknown; notifyRan: boolean }> => {
    const encodePage = Schema.encodeUnknownEffect(
      Schema.fromJsonString(ContactPage),
    );
    const pageJson = await Effect.runPromise(
      encodePage(ContactPage.make({ ...defaultContactPage, enabled: false })),
    );

    let notifyRan = false;
    const action = formAction({
      form: 'contact',
      page: 'contact',
      notify: () =>
        Effect.sync(() => {
          notifyRan = true;
        }),
      success: {
        title: 'contact.form.success.title',
        description: 'contact.form.success.description',
      },
    });

    const url = 'http://localhost/contact';
    const request = new Request(url, {
      method: 'POST',
      body: new URLSearchParams(body),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const context = new RouterContextProvider();
    context.runtime = makeRequestRuntimeFromLayer(
      makeTestAppLayer(
        layerTest({ [pageObjectKey('contact')]: { body: pageJson } }),
      ),
    );

    let thrown: unknown;
    try {
      await action({
        request,
        url: new URL(url),
        pattern: '/contact',
        params: {},
        context,
      });
    } catch (error) {
      thrown = error;
    }
    return { thrown, notifyRan };
  };

  it('404s the action when the owning page is DISABLED (Feature C, Codex #6)', async () => {
    // A disabled page rejects POSTs too, not only its GET. The runtime maps the
    // yielded NotFoundError to a 404 (React Router's `data('Not Found', { status:
    // 404 })`, a `DataWithResponseInit`), and the body never ran.
    const { thrown, notifyRan } = await runDisabledPagePost({
      method: 'email',
      name: 'Ada',
      email: 'ada@example.com',
      message: 'hi',
    });
    const status = (thrown as { init?: { status?: number } })?.init?.status;
    expect(status).toBe(404);
    expect(notifyRan).toBe(false);
  });

  it('404s a HONEYPOT-filled POST to a disabled page (gate runs before honeypot)', async () => {
    // The route-level gate runs BEFORE form-data parse + honeypot handling, so a
    // honeypot-filled POST to a disabled page 404s too — it must NOT short-circuit
    // to a 200-ish honeypot "success" that masks the disabled page (Codex #6).
    const { thrown, notifyRan } = await runDisabledPagePost({
      name: 'Ada',
      website: 'https://spam.example', // honeypot
    });
    const status = (thrown as { init?: { status?: number } })?.init?.status;
    expect(status).toBe(404);
    expect(notifyRan).toBe(false);
  });

  it('skips the body (no notify) when the honeypot is filled', async () => {
    let notifyRan = false;
    const action = formAction({
      form: 'contact',
      page: 'contact',
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
      await makeFormArgs({ name: 'Ada', website: 'https://spam.example' }),
    );

    expect(notifyRan).toBe(false);
    expect(result.status).toBe('success');
  });
});

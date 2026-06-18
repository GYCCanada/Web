import { describe, expect, it } from 'bun:test';
import { Effect, ManagedRuntime } from 'effect';
import { RouterContextProvider } from 'react-router';

import { Schema } from 'effect';

import { Content } from '../content.server';
import {
  defaultContactForm,
  defaultContactPage,
} from '../content/pages/defaults';
import { formObjectKey, pageObjectKey } from '../content/pages/registry';
import { ContactPage } from '../content/pages/schema';
import { formValidationError } from '../effect/errors';
import { makeAppLayer, makeRequestRuntimeFromLayer } from '../effect/runtime';
import { ReactRouterContext, type RouteArgs } from '../effect/router-context';
import { Storage } from '../storage.server';
import { layerTest } from '../storage.test-helper';

import { formAction } from './action';
import { FormDefinition } from './definition';
import type { Submission } from './submission';

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

const makeFormArgs = (fields: Record<string, string>): RouteArgs => {
  const body = new URLSearchParams(fields);
  const url = 'http://localhost/contact';
  const request = new Request(url, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const context = new RouterContextProvider();
  context.runtime = makeRequestRuntimeFromLayer(makeAppLayer(layerTest({})));
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
    let notified: Submission | undefined;
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
    let notified: Submission | undefined;
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
      page: 'contact',
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

  // settled #8 — persist-FIRST, notify-second: a notify failure provably cannot
  // lose the record, because `Submissions.persist` ran and returned its durable
  // object BEFORE `notify`. We build ONE app layer over a single in-memory bucket,
  // run the action (whose notify fails) through it, then read that SAME bucket back
  // through the same runtime and find the persisted `submissions/contact/<id>.json`.
  it('a notify failure still leaves the persisted record on the bucket (persist-first)', async () => {
    const storage = layerTest({});
    const appLayer = makeAppLayer(storage);
    const runtime = ManagedRuntime.make(appLayer);

    const args = makeFormArgs({
      method: 'email',
      name: 'Persisted Ada',
      email: 'ada@example.com',
      message: 'hi',
    });
    // Run against the SAME runtime (so the readback sees the same in-memory
    // bucket), providing `ReactRouterContext` exactly as the production runtime
    // does.
    args.context.runtime = {
      run: (routeArgs, effect) =>
        runtime.runPromise(
          effect.pipe(Effect.provideService(ReactRouterContext, routeArgs)),
        ),
    };

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

    const result = await action(args);
    expect(result.status).toBe('error');

    // The record is on the bucket despite the notify failure.
    const listed = await runtime.runPromise(
      Effect.gen(function* () {
        const s = yield* Storage.Service;
        return yield* s.list('submissions/contact/');
      }),
    );
    expect(listed.length).toBe(1);
    expect(listed[0]?.key).toMatch(/^submissions\/contact\/.+\.json$/);
  });

  // Single-Storage-instance proof: `makeAppLayer` shares ONE `Storage` between
  // `Content` and `Submissions`. A CMS-edited `forms/contact.json` seeded into the
  // injected bucket must be visible to `Content.getForm` (the read `Submissions.
  // persist` makes), proving Content reads through the SAME injected bucket the
  // persist path writes to — NOT a separate baked-in `Storage.layerOptional`. If
  // Content read through a second instance, it would fall back to the bundled
  // default title and this assertion would fail.
  it('Content.getForm reads the CMS-edited form from the SAME injected bucket the persist path writes to', async () => {
    const editedTitle = 'CMS-edited contact form';
    const edited = FormDefinition.make({
      ...defaultContactForm,
      title: { ...defaultContactForm.title, en: editedTitle },
    });
    const encodeForm = Schema.encodeUnknownEffect(
      Schema.fromJsonString(FormDefinition),
    );
    const json = await Effect.runPromise(encodeForm(edited));

    const storage = layerTest({ [formObjectKey('contact')]: { body: json } });
    const runtime = ManagedRuntime.make(makeAppLayer(storage));

    // Resolved through the full app runtime — the same `Content.Service` the
    // persist path calls `getForm` on. It reads the seeded, CMS-edited object.
    const form = await runtime.runPromise(
      Effect.gen(function* () {
        const content = yield* Content.Service;
        return yield* content.getForm('contact');
      }),
    );
    expect(form.title.en).toBe(editedTitle);
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
      makeAppLayer(layerTest({ [pageObjectKey('contact')]: { body: pageJson } })),
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
      makeFormArgs({ name: 'Ada', website: 'https://spam.example' }),
    );

    expect(notifyRan).toBe(false);
    expect(result.status).toBe('success');
  });
});

import { afterEach, describe, expect, it } from 'bun:test';
import { Effect, Layer, ManagedRuntime, Option } from 'effect';
import { RouterContextProvider } from 'react-router';

import { Schema } from 'effect';

import { defaultContactPage } from '../content/pages/defaults';
import { pageObjectKey } from '../content/pages/registry';
import { ContactPage } from '../content/pages/schema';
import {
  makeRequestRuntimeFromLayer,
  type RequestRuntime,
} from '../effect/runtime';
import { makeTestAppLayer } from '../effect/runtime.test-helper';
import type { RouteArgs } from '../effect/router-context';
import { Mailer } from '../mailer.server';
import { layerTest } from '../storage.test-helper';

import { formAction } from './action';
import { Forms } from './forms.server';
import {
  FORM_VERSION_FIELD,
  IDEMPOTENCY_TOKEN_FIELD,
  newSubmissionCommandFields,
  resolveSubmissionCommandFields,
} from './submission-command';

interface SentMail {
  readonly subject: string;
  readonly content: string;
  readonly idempotencyKey?: string;
}

const capturingMailer = (sent: SentMail[]) =>
  Layer.succeed(
    Mailer.Service,
    Mailer.Service.of({
      send: (input) =>
        Effect.sync(() => {
          sent.push(input);
        }),
    }),
  );

const requestRuntimes: RequestRuntime[] = [];
afterEach(async () => {
  await Promise.all(requestRuntimes.splice(0).map((runtime) => runtime.dispose()));
});

/**
 * Branch 6.2 — the generic action skeleton; Branch 7.3 — persist-then-notify.
 *
 * `formAction({ form, page, success })` collapses the `parse → relational commit
 * → notification dispatch → toast.redirect` pipeline into one wrapped route
 * action. These tests pin the pipeline WIRING (`prove-it-works`) — the per-kind
 * decode semantics are covered exhaustively in `decode.test.ts` and the durable
 * commit contract in `forms.server.test.ts`. We pin only the adapter's own wiring:
 *   - a valid submission commits the durable record, sends its canonical
 *     notification through `Mailer`, then redirects with the success toast;
 *   - a `Mailer` failure mapped to a form-level key aborts
 *     the redirect and surfaces as a form error report — and the record is ALREADY
 *     persisted (persist ran first), the record-vs-notify separation settled #8
 *     demands;
 *   - the honeypot short-circuit skips the body entirely (no commit, no mail).
 *
 * The action runs through the real request runtime with an isolated relational
 * database and in-memory object storage for the owning Page. `Forms`, `Content`,
 * `Toast`, and `Mailer` are the same application boundaries the live server
 * provides.
 */

const makeFormArgs = async (
  fields: Record<string, string>,
  mailerLayer: NonNullable<Parameters<typeof makeTestAppLayer>[1]> = Mailer.layer,
): Promise<RouteArgs> => {
  const appLayer = makeTestAppLayer(layerTest({}), mailerLayer);
  const runtime = ManagedRuntime.make(appLayer);
  const published = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Forms.Service).current('contact');
    }),
  );
  await runtime.dispose();
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
  requestRuntimes.push(context.runtime);
  return {
    request,
    url: new URL(url),
    pattern: '/contact',
    params: {},
    context,
  };
};

describe('formAction', () => {
  it('persists, sends the stored record notification, then redirects with the success toast', async () => {
    const sent: SentMail[] = [];
    const action = formAction({
      form: 'contact',
      page: 'contact',
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
        }, capturingMailer(sent)),
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
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe('[!] Contact Inquiry from Ada');
    expect(sent[0]?.content).toBe(
      'Name: Ada\nEmail: ada@example.com\nMessage: hi',
    );
    expect(sent[0]?.idempotencyKey).toMatch(/^form:[A-Za-z0-9_-]+:admin-email$/);
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
    const sent: SentMail[] = [];
    const action = formAction({
      form: 'contact',
      page: 'contact',
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
        }, capturingMailer(sent)),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.content).toBe(
      'Name: Ada\nPhone: 123-456-7890\nMessage: hi',
    );
  });

  it('a present-blank inactive field (the pre-fix unconditional render) FAILS — why the renderer must gate it', async () => {
    const action = formAction({
      form: 'contact',
      page: 'contact',
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
      }, Layer.succeed(
        Mailer.Service,
        Mailer.Service.of({
          send: () => Effect.fail(new Mailer.MailError({})),
        }),
      )),
    );

    expect(result.status).toBe('error');
    expect(result.result.error?.formErrors).toEqual(['contact.form.error']);
    expect(
      Schema.is(Forms.FormDefinitionVersionId)(
        result.command.preserved[FORM_VERSION_FIELD],
      ),
    ).toBe(true);
    expect(
      Schema.is(Forms.IdempotencyToken)(
        result.command.preserved[IDEMPOTENCY_TOKEN_FIELD],
      ),
    ).toBe(true);
    expect(result.command.disposition).toBe('preserve');
  });

  it('refreshes the loader command after the rendered definition advances', async () => {
    const action = formAction({
      form: 'contact',
      page: 'contact',
      success: {
        title: 'contact.form.success.title',
        description: 'contact.form.success.description',
      },
    });
    const args = await makeFormArgs({
      method: 'email',
      name: 'Ada',
      email: 'ada@example.com',
      message: 'hi',
    });
    const published = await args.context.runtime.run(
      args,
      Effect.gen(function* () {
        const forms = yield* Forms.Service;
        const current = yield* forms.current('contact');
        return yield* forms.publish({
          form: 'contact',
          expectedCurrentVersion: Option.some(current.version),
          definition: {
            ...current.definition,
            title: { en: 'Advanced', fr: 'Avancé' },
          },
        });
      }),
    );

    const result = await action(args);
    const fallback = newSubmissionCommandFields(published.version);

    expect(result.command.disposition).toBe('refreshDefinition');
    expect(resolveSubmissionCommandFields(fallback, result.command)).toBe(
      fallback,
    );
  });

  it('rotates the loader token after an idempotency conflict', async () => {
    const action = formAction({
      form: 'contact',
      page: 'contact',
      success: {
        title: 'contact.form.success.title',
        description: 'contact.form.success.description',
      },
    });
    const args = await makeFormArgs({
      method: 'email',
      name: 'Ada',
      email: 'ada@example.com',
      message: 'second command',
    });
    const posted = await args.request.clone().formData();
    const version = Schema.decodeUnknownSync(Forms.FormDefinitionVersionId)(
      posted.get(FORM_VERSION_FIELD),
    );
    const token = Schema.decodeUnknownSync(Forms.IdempotencyToken)(
      posted.get(IDEMPOTENCY_TOKEN_FIELD),
    );
    await args.context.runtime.run(
      args,
      Effect.gen(function* () {
        yield* (yield* Forms.Service).submit({
          form: 'contact',
          expectedVersion: version,
          idempotencyToken: token,
          payloads: [
            {
              method: 'email',
              name: 'Ada',
              email: 'ada@example.com',
              message: 'first command',
            },
          ],
        });
      }),
    );

    const result = await action(args);
    const fallback = newSubmissionCommandFields(version);

    expect(result.command.disposition).toBe('rotateToken');
    expect(resolveSubmissionCommandFields(fallback, result.command)).toBe(
      fallback,
    );
    expect(fallback.idempotencyToken).not.toBe(token);
  });

  // Run a contact `formAction` whose owning page is seeded DISABLED, against the
  // given POST body. Returns the thrown 404 (a `DataWithResponseInit`) + the sent
  // mail count. The gate must 404 EVERY POST, including a honeypot-filled one, so
  // both bodies route through this helper.
  const runDisabledPagePost = async (
    body: Record<string, string>,
  ): Promise<{ thrown: unknown; sentCount: number }> => {
    const encodePage = Schema.encodeUnknownEffect(
      Schema.fromJsonString(ContactPage),
    );
    const pageJson = await Effect.runPromise(
      encodePage(ContactPage.make({ ...defaultContactPage, enabled: false })),
    );

    const sent: SentMail[] = [];
    const action = formAction({
      form: 'contact',
      page: 'contact',
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
        capturingMailer(sent),
      ),
    );
    requestRuntimes.push(context.runtime);

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
    return { thrown, sentCount: sent.length };
  };

  it('404s the action when the owning page is DISABLED (Feature C, Codex #6)', async () => {
    // A disabled page rejects POSTs too, not only its GET. The runtime maps the
    // yielded NotFoundError to a 404 (React Router's `data('Not Found', { status:
    // 404 })`, a `DataWithResponseInit`), and the body never ran.
    const { thrown, sentCount } = await runDisabledPagePost({
      method: 'email',
      name: 'Ada',
      email: 'ada@example.com',
      message: 'hi',
    });
    const status = (thrown as { init?: { status?: number } })?.init?.status;
    expect(status).toBe(404);
    expect(sentCount).toBe(0);
  });

  it('404s a HONEYPOT-filled POST to a disabled page (gate runs before honeypot)', async () => {
    // The route-level gate runs BEFORE form-data parse + honeypot handling, so a
    // honeypot-filled POST to a disabled page 404s too — it must NOT short-circuit
    // to a 200-ish honeypot "success" that masks the disabled page (Codex #6).
    const { thrown, sentCount } = await runDisabledPagePost({
      name: 'Ada',
      website: 'https://spam.example', // honeypot
    });
    const status = (thrown as { init?: { status?: number } })?.init?.status;
    expect(status).toBe(404);
    expect(sentCount).toBe(0);
  });

  it('skips the body (no notify) when the honeypot is filled', async () => {
    const sent: SentMail[] = [];
    const action = formAction({
      form: 'contact',
      page: 'contact',
      success: {
        title: 'contact.form.success.title',
        description: 'contact.form.success.description',
      },
    });

    const result = await action(
      await makeFormArgs(
        { name: 'Ada', website: 'https://spam.example' },
        capturingMailer(sent),
      ),
    );

    expect(sent).toHaveLength(0);
    expect(result.status).toBe('success');
  });
});

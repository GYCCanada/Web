import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Layer, ManagedRuntime, Schema } from 'effect';
import { RouterContextProvider } from 'react-router';

import { Auth } from '~/lib/auth.server';
import { Content } from '~/lib/content.server';
import { assembleOverrides } from '~/lib/content/admin-form';
import { formDraftKey } from '~/lib/content/pages/registry';
import { FormDefinition } from '~/lib/forms/definition';
import { makeAppLayer, makeRequestRuntimeFromLayer } from '~/lib/effect/runtime';
import type { RouteArgs } from '~/lib/effect/router-context';
import { Storage } from '~/lib/storage.server';
import { layerTest } from '~/lib/storage.test-helper';

import { action } from './forms.$form';

/**
 * The per-Form `/admin/forms/:form` editor action (registrar plan C9). The form
 * editor reuses the SAME deep `DraftEditor` the page editor uses, scoped to a form
 * (`formScope`), so save/publish/cache-bust come for free; these tests drive the
 * REAL route action (past the auth gate, over an in-memory `Storage`) and assert:
 *   - a party-copy edit lands on the stored DRAFT (the merge-onto-current-document
 *     path decodes at the form's `FormDefinition` boundary);
 *   - publish busts ONLY that form's read cache so the edit is live with no
 *     redeploy (ADR 0008 per-object isolation);
 *   - the C9 numeric leaf-coercion (`base`/`unit`/`min`/`max` → `Number`) is a
 *     pure boundary transform `assembleOverrides` applies (so a string FormData
 *     decodes at the `Cents`/`number`-kind boundary), with an empty numeric input
 *     dropped so an `optionalKey` bound stays absent.
 *
 * Admin secrets are injected through a scoped `ConfigProvider` (the project's
 * Effect-config discipline), never `process.env`.
 */

const PASSWORD = 'correct-horse';
const SECRET = 'a-signing-secret-of-sufficient-length';

const adminConfig = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: { ADMIN_PASSWORD: PASSWORD, COOKIE_SECRET: SECRET },
  }),
);

const makeLayer = () => Layer.provide(makeAppLayer(layerTest({})), adminConfig);

const makeContext = () => {
  const layer = makeLayer();
  const context = new RouterContextProvider();
  context.runtime = makeRequestRuntimeFromLayer(layer);
  return { layer, context };
};

const mintCookie = async (
  layer: ReturnType<typeof makeLayer>,
): Promise<string> => {
  const runtime = ManagedRuntime.make(layer);
  const header = await runtime.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const token = yield* auth.verifyPassword(PASSWORD);
      return auth.cookieHeader(token);
    }),
  );
  await runtime.dispose();
  return header;
};

/** POST urlencoded fields to the registration form editor action (real action). */
const postFormFields = async (
  fields: ReadonlyArray<readonly [string, string]>,
): Promise<{ res: Response; args: RouteArgs }> => {
  const { layer, context } = makeContext();
  const cookie = await mintCookie(layer);

  const body = new URLSearchParams();
  for (const [name, value] of fields) body.append(name, value);
  const url = 'http://localhost/admin/forms/registration';
  const request = new Request(url, {
    method: 'POST',
    body,
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
  const args: RouteArgs = {
    request,
    url: new URL(url),
    pattern: '/admin/forms/:form',
    params: { form: 'registration' },
    context,
  };
  const res = (await action(args)) as Response;
  return { res, args };
};

/** Read + decode the stored registration DRAFT through the action's own bucket. */
const readDraft = async (args: RouteArgs): Promise<FormDefinition> => {
  const draftJson = await args.context.runtime.run(
    args,
    Effect.gen(function* () {
      const storage = yield* Storage.Service;
      const object = yield* storage.get(formDraftKey('registration'));
      return yield* Effect.promise(() => new Response(object.stream).text());
    }),
  );
  return Schema.decodeUnknownSync(FormDefinition)(JSON.parse(draftJson));
};

describe('registration form editor action — party copy edit (C9)', () => {
  it('a group-mode label edit lands on the stored draft', async () => {
    const { res, args } = await postFormFields([
      ['intent', 'save-draft'],
      ['party.billingMode.options.group.en', 'One payer for the whole group'],
      ['party.billingMode.options.group.fr', 'Un payeur pour tout le groupe'],
    ]);
    expect(res.status).toBe(302);
    const draft = await readDraft(args);
    expect(draft.party?.billingMode.options.group?.en).toBe(
      'One payer for the whole group',
    );
    // An unedited sibling (the perRegistrant label) survives the merge verbatim.
    expect(draft.party?.billingMode.options.perRegistrant?.en).toBe(
      'Each person pays for themselves',
    );
  });

  it('publishing busts only this form’s read cache so the edit is live', async () => {
    const { res, args } = await postFormFields([
      ['intent', 'publish'],
      ['party.payer.label.en', 'Who is footing the bill?'],
      ['party.payer.label.fr', 'Qui règle la note?'],
    ]);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('Published');

    const live = await args.context.runtime.run(
      args,
      Effect.gen(function* () {
        const content = yield* Content.Service;
        yield* content.bust({ kind: 'form', form: 'registration' });
        return yield* content.getForm('registration');
      }),
    );
    expect(live.party?.payer?.label.en).toBe('Who is footing the bill?');
  });
});

describe('assembleOverrides — C9 numeric leaf-coercion', () => {
  it('pricing/quantity numeric leaves coerce to real numbers', () => {
    const override = assembleOverrides(
      new URLSearchParams([
        ['pricing.base', '5000'],
        ['pricing.rules.r1.unit', '500'],
        ['tickets.min', '1'],
        ['tickets.max', '10'],
        ['title.en', 'Registration'],
      ]).entries(),
    ) as Record<string, unknown>;

    const pricing = override['pricing'] as Record<string, unknown>;
    expect(pricing['base']).toBe(5000);
    expect((pricing['rules'] as Record<string, Record<string, unknown>>)['r1']!['unit']).toBe(500);
    const tickets = override['tickets'] as Record<string, unknown>;
    expect(tickets['min']).toBe(1);
    expect(tickets['max']).toBe(10);
    // A non-numeric leaf (a bilingual title half) stays a string.
    expect((override['title'] as Record<string, unknown>)['en']).toBe(
      'Registration',
    );
  });

  it('an empty numeric leaf is dropped (an optionalKey bound stays absent)', () => {
    const override = assembleOverrides(
      new URLSearchParams([
        ['tickets.min', '1'],
        ['tickets.max', ''],
      ]).entries(),
    ) as Record<string, unknown>;
    const tickets = override['tickets'] as Record<string, unknown>;
    expect(tickets['min']).toBe(1);
    expect('max' in tickets).toBe(false);
  });
});

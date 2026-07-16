import { afterEach, describe, expect, it } from 'bun:test';
import { Effect, Schema } from 'effect';
import { RouterContextProvider } from 'react-router';

import { defaultHomePage } from '~/lib/content/pages/defaults';
import { pageObjectKey } from '~/lib/content/pages/registry';
import { HomePage } from '~/lib/content/pages/schema';
import {
  makeRequestRuntimeFromLayer,
  type RequestRuntime,
} from '~/lib/effect/runtime';
import { makeTestAppLayer } from '~/lib/effect/runtime.test-helper';
import type { RouteArgs } from '~/lib/effect/router-context';
import { layerTest } from '~/lib/storage.test-helper';

import { action } from './_index';

const runtimes: RequestRuntime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

/**
 * The home route owns the newsletter POST action. Feature C / Codex #6 require a
 * disabled page to 404 its OWNED action too, not only its GET — and the 404 gate
 * must run BEFORE honeypot handling so a honeypot-filled POST cannot short-circuit
 * to a 200-ish "success" that masks the 404. These pin that contract for the home
 * action specifically (the contact/volunteer formAction path is pinned in
 * `forms/action.test.ts`).
 */

const seedDisabledHome = async (): Promise<RouteArgs['context']> => {
  const json = await Effect.runPromise(
    Schema.encodeUnknownEffect(Schema.fromJsonString(HomePage))(
      HomePage.make({ ...defaultHomePage, enabled: false }),
    ),
  );
  const context = new RouterContextProvider();
  context.runtime = makeRequestRuntimeFromLayer(
    makeTestAppLayer(layerTest({ [pageObjectKey('home')]: { body: json } })),
  );
  runtimes.push(context.runtime);
  return context;
};

const postHome = async (
  body: Record<string, string>,
): Promise<{ init?: { status?: number } } | undefined> => {
  const url = 'http://localhost/';
  const request = new Request(url, {
    method: 'POST',
    body: new URLSearchParams(body),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  let thrown: unknown;
  try {
    await action({
      request,
      url: new URL(url),
      pattern: '/',
      params: {},
      context: await seedDisabledHome(),
    });
  } catch (error) {
    thrown = error;
  }
  return thrown as { init?: { status?: number } } | undefined;
};

describe('home newsletter action 404s when the home page is disabled', () => {
  it('404s a normal newsletter POST to a disabled home page', async () => {
    const thrown = await postHome({
      name: 'Ada',
      email: 'ada@example.com',
    });
    expect(thrown?.init?.status).toBe(404);
  });

  it('404s a HONEYPOT-filled POST to a disabled home page (gate before honeypot)', async () => {
    const thrown = await postHome({
      name: 'Ada',
      // The honeypot field; if the gate ran AFTER honeypot handling this would
      // short-circuit to success and mask the 404.
      website: 'https://spam.example',
    });
    expect(thrown?.init?.status).toBe(404);
  });
});

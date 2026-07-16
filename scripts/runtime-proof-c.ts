/**
 * Runtime proof (Feature C) — drives the REAL route loaders + layout loader over
 * an in-memory `Storage` seeded with published page docs, exercising the same
 * give-toggle + team-flip scenario the plan describes (docs/cms-images-enable-plan.md
 * "Runtime proof (C)") WITHOUT requiring a live R2 bucket. This is end-to-end
 * through the actual exported `loader`s (not mocks): the nav links come from the
 * `_layout` loader's `getEnabledPages()`, and a disabled page's loader genuinely
 * throws a 404 `data(...)` response.
 *
 * Run: `bun scripts/runtime-proof-c.ts`
 */
import { Effect, Schema } from 'effect';
import { RouterContextProvider } from 'react-router';

import {
  defaultGivePage,
  defaultTeamPage,
} from '../app/lib/content/pages/defaults';
import { pageObjectKey } from '../app/lib/content/pages/registry';
import { GivePage, TeamPage } from '../app/lib/content/pages/schema';
import {
  makeTestAppLayer,
  makeRequestRuntimeFromLayer,
} from '../app/lib/effect/runtime';
import { layerTest } from '../app/lib/storage.test-helper';

import { loader as layoutLoader } from '../app/routes/($lang)+/_layout';
import { loader as giveLoader } from '../app/routes/($lang)+/give';

type Seed = { give: boolean; team: boolean };

const encodeGive = Schema.encodeUnknownEffect(Schema.fromJsonString(GivePage));
const encodeTeam = Schema.encodeUnknownEffect(Schema.fromJsonString(TeamPage));

/** Seed an in-memory bucket with give + team published docs at the given flags. */
const seed = async ({ give, team }: Seed) => {
  const giveJson = await Effect.runPromise(
    encodeGive(GivePage.make({ ...defaultGivePage, enabled: give })),
  );
  const teamJson = await Effect.runPromise(
    encodeTeam(TeamPage.make({ ...defaultTeamPage, enabled: team })),
  );
  const context = new RouterContextProvider();
  const runtime = makeRequestRuntimeFromLayer(
    makeTestAppLayer(
      layerTest({
        [pageObjectKey('give')]: { body: giveJson },
        [pageObjectKey('team')]: { body: teamJson },
      }),
    ),
  );
  context.runtime = runtime;
  return { context, runtime };
};

const argsFor = (context: RouterContextProvider, path: string) => {
  const url = `http://localhost${path}`;
  return {
    request: new Request(url),
    url: new URL(url),
    pattern: path === '/' ? '/' : '/:page',
    params: {},
    context,
  };
};

/** Run the layout loader and return the enabled-flag map it exposes to the nav. */
const navEnabled = async (
  context: RouterContextProvider,
): Promise<Record<string, boolean>> => {
  const result = (await layoutLoader(argsFor(context, '/'))) as {
    enabled: Record<string, boolean>;
  };
  return result.enabled;
};

/** Run the give loader; return 'ok' if it renders, '404' if it throws a 404. */
const giveStatus = async (
  context: RouterContextProvider,
): Promise<'ok' | '404'> => {
  try {
    await giveLoader(argsFor(context, '/give'));
    return 'ok';
  } catch (thrown) {
    const status = (thrown as { init?: { status?: number } })?.init?.status;
    if (status === 404) return '404';
    throw thrown;
  }
};

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const assert = (label: string, ok: boolean): void => {
  line(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) process.exitCode = 1;
};

const main = async (): Promise<void> => {
  const harnesses: Awaited<ReturnType<typeof seed>>[] = [];
  try {
    // 1. give DISABLED, team DISABLED (today's shipped default).
    const off = await seed({ give: false, team: false });
    harnesses.push(off);
    const offNav = await navEnabled(off.context);
    assert('give disabled -> give absent from nav', offNav['give'] === false);
    assert(
      'give disabled -> /give loader 404s',
      (await giveStatus(off.context)) === '404',
    );
    assert(
      'team disabled (default) -> team absent from nav',
      offNav['team'] === false,
    );

    // 2. give ENABLED -> nav link returns + /give renders.
    const giveOn = await seed({ give: true, team: false });
    harnesses.push(giveOn);
    const giveOnNav = await navEnabled(giveOn.context);
    assert('give enabled -> give present in nav', giveOnNav['give'] === true);
    assert(
      'give enabled -> /give loader renders',
      (await giveStatus(giveOn.context)) === 'ok',
    );

    // 3. team FLIPPED on -> team nav link returns (the CMS-team visibility flip).
    const teamOn = await seed({ give: true, team: true });
    harnesses.push(teamOn);
    const teamOnNav = await navEnabled(teamOn.context);
    assert('team enabled -> team present in nav', teamOnNav['team'] === true);

    line(
      process.exitCode === 1
        ? '\nRUNTIME PROOF FAILED'
        : '\nRUNTIME PROOF PASSED',
    );
  } finally {
    await Promise.all(harnesses.map(({ runtime }) => runtime.dispose()));
  }
};

await main();

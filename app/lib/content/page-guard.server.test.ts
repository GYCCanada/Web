import { describe, expect, it } from 'effect-bun-test';
import { Effect, Exit, Layer, Schema } from 'effect';

import { Content } from '../content.server';
import { NotFoundError } from '../effect/errors';
import { Storage } from '../storage.server';
import { layerTest } from '../storage.test-helper';
import { defaultGivePage, defaultTeamPage } from './pages/defaults';
import { pageObjectKey } from './pages/registry';
import { GivePage, TeamPage } from './pages/schema';
import { getEnabledPageOr404 } from './page-guard.server';

/**
 * `getEnabledPageOr404` is the shared 404 gate every public page route loader (and,
 * via `formAction`, the contact/volunteer actions) reads through (Feature C, Codex
 * #6). These pin its contract: an ENABLED page is returned (its decoded content,
 * carrying `enabled: true`); a DISABLED page fails with `NotFoundError` (mapped to a
 * 404 by the runtime) — a disabled evergreen page genuinely does not exist for the
 * public. Driven off the SAME per-page object the nav reads (`derive-dont-sync`).
 */

const seedJson = <A>(
  schema: Schema.Codec<A, unknown>,
  value: A,
): Effect.Effect<string> =>
  Schema.encodeUnknownEffect(Schema.fromJsonString(schema))(value).pipe(
    Effect.orDie,
  );

const provide = (storage: Layer.Layer<Storage.Service>) =>
  Effect.provide(Layer.provideMerge(Content.layer, storage));

/** True iff the exit failed with a `NotFoundError` (the 404 the runtime maps). */
const failedWithNotFound = (exit: Exit.Exit<unknown, unknown>): boolean =>
  Exit.isFailure(exit) &&
  exit.cause.reasons.some(
    (reason) => reason._tag === 'Fail' && NotFoundError.is(reason.error),
  );

describe('getEnabledPageOr404', () => {
  it.effect('returns the page when enabled (give default is enabled:true)', () =>
    Effect.gen(function* () {
      // Empty bucket → bundled default give page, which is enabled:true.
      const give = yield* getEnabledPageOr404('give');
      expect(give.enabled).toBe(true);
      expect(give.donateUrl).toBe(defaultGivePage.donateUrl);
    }).pipe(provide(layerTest({}))));

  it.effect('fails with NotFoundError when the page is disabled (give.enabled=false)', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(getEnabledPageOr404('give'));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failedWithNotFound(exit)).toBe(true);
      }
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          Content.layer,
          Layer.unwrap(
            seedJson(
              GivePage,
              GivePage.make({ ...defaultGivePage, enabled: false }),
            ).pipe(
              Effect.map((json) =>
                layerTest({ [pageObjectKey('give')]: { body: json } }),
              ),
            ),
          ),
        ),
      ),
    ));

  it.effect('team default is hidden (404s) until flipped enabled:true', () =>
    Effect.gen(function* () {
      // Empty bucket → bundled team default, which ships enabled:false → 404.
      const exit = yield* Effect.exit(getEnabledPageOr404('team'));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failedWithNotFound(exit)).toBe(true);
      }
    }).pipe(provide(layerTest({}))));

  it.effect('a published team.json with enabled:true is returned (the page exists again)', () =>
    Effect.gen(function* () {
      const team = yield* getEnabledPageOr404('team');
      expect(team.enabled).toBe(true);
      expect(team.subtitle).toEqual(defaultTeamPage.subtitle);
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          Content.layer,
          Layer.unwrap(
            seedJson(
              TeamPage,
              TeamPage.make({ ...defaultTeamPage, enabled: true }),
            ).pipe(
              Effect.map((json) =>
                layerTest({ [pageObjectKey('team')]: { body: json } }),
              ),
            ),
          ),
        ),
      ),
    ));
});

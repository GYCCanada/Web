import { describe, expect, it } from 'effect-bun-test';
import { Effect, Exit, Layer, Schema } from 'effect';

import { Content } from '../../content.server';
import { NotFoundError } from '../../effect/errors';
import { Storage } from '../../storage.server';
import { layerTest } from '../../storage.test-helper';
import { defaultFaqPage } from './defaults';
import { readPageView } from './pages.server';
import { pageObjectKey } from './registry';
import { FaqPage } from './schema';

const provide = (storage: Layer.Layer<Storage.Service>) =>
  Effect.provide(Layer.provideMerge(Content.layer, storage));

describe('readPageView', () => {
  it.effect('returns only the requested Locale from an enabled Page', () =>
    Effect.gen(function* () {
      const page = yield* readPageView('faq', 'fr');
      expect(page.title).toBe(defaultFaqPage.title.fr);
      expect(page.title).not.toBe(defaultFaqPage.title.en);
      expect(page.items[0]?.question).toBe(defaultFaqPage.items[0]?.question.fr);
    }).pipe(provide(layerTest({}))));

  it.effect('fails with NotFoundError before projecting a disabled Page', () =>
    Effect.gen(function* () {
      const json = yield* Schema.encodeUnknownEffect(
        Schema.fromJsonString(FaqPage),
      )(FaqPage.make({ ...defaultFaqPage, enabled: false }));
      return yield* Effect.exit(readPageView('faq', 'en')).pipe(
        Effect.provide(
          Layer.provideMerge(
            Content.layer,
            layerTest({ [pageObjectKey('faq')]: { body: json } }),
          ),
        ),
      );
    }).pipe(
      Effect.flatMap((exit) => {
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) return Effect.void;
        expect(
          exit.cause.reasons.some(
            (reason) =>
              reason._tag === 'Fail' && NotFoundError.is(reason.error),
          ),
        ).toBe(true);
        return Effect.void;
      }),
    ));
});

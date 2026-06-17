import { describe, expect, it } from 'bun:test';
import { Effect, Layer, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { Content, SITE_CONTENT_KEY } from '../content.server';
import { Storage } from '../storage.server';
import { layerTest } from '../storage.test-helper';
import {
  assembleOverrides,
  isAcceptedImageType,
  uploadedImageKey,
  type Json,
} from './admin-form';
import { DraftEditor, siteScope } from './draft-editor.server';
import { defaultContent } from './defaults';
import { addOp, removeOp, reorderOp } from './list-edit';
import { newListItemId, SiteContent } from './schema';

/**
 * End-to-end-ish proof of the C5 publish + image paths against the in-memory
 * `layerTest` storage helper (a real S3 / MinIO is not reachable headless in CI).
 * Post-Branch-1 the `/admin/content` route action is auth + a `DraftEditor`
 * call only: this test drives that ONE service — `editDocument` (save draft),
 * `publish` (promote draft → live + bust), `applyImageUpload` (rewrite a key on
 * the draft) — and asserts the public read path reflects the edit WITHOUT a TTL
 * wait or redeploy (D3), and that an uploaded image is retrievable from
 * `Storage.get` under its `images/uploads/<key>`.
 */

// The JSON-string codec (not `JSON.stringify`, per the project lint rule):
// `encodeJson(value)` is exactly the bytes stored at `content/site.json`.
const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(SiteContent));

/** The bundled defaults as the JSON STRING stored at `content/site.json`. */
const seedBody = (): Promise<string> =>
  Effect.runPromise(encodeJson(defaultContent));

/**
 * Wire `DraftEditor` (over the `Content` it depends on) and `Content` itself
 * over ONE shared in-memory bucket, also exposed to the test — so the editor's
 * writes and the public read path hit the same store. `Content.layer` feeds
 * `DraftEditor.layer`'s `Content.Service` requirement and stays exposed.
 */
const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    DraftEditor.Service | Content.Service | Storage.Service
  >,
  objects: Record<string, { body: string }> = {},
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(effect, [
        Layer.provideMerge(
          Layer.provideMerge(DraftEditor.layer, Content.layer),
          layerTest(objects),
        ),
        TestClock.layer(),
      ]),
    ),
  );

describe('CMS publish → cache-bust → public read (in-memory bucket, D3)', () => {
  it('an /admin edit is visible on the next public read with no redeploy', async () => {
    const seed = await seedBody();

    const result = await run(
      Effect.gen(function* () {
        const content = yield* Content.Service;
        const editor = yield* DraftEditor.Service;

        // 1. The public site reads the seeded defaults.
        const before = yield* content.getConference('en', 2026);

        // 2. The admin edits the 2026 theme name + accent (simulating the form's
        //    parsed override), then publishes — the route's two-step.
        const override = assembleOverrides([
          ['conferences.2.themeName.en', 'Speak Boldly'],
          ['conferences.2.accentColor', '#112233'],
        ]) as Json;
        // Advance so the saved draft is strictly newer than the epoch seed.
        yield* TestClock.adjust('1 second');
        yield* editor.editDocument(siteScope, override);
        yield* editor.publish(siteScope);

        // 3. The public site reflects the edit immediately — no TTL advance.
        const after = yield* content.getConference('en', 2026);

        return { before, after };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    expect(result.before.title).toBe('Speak');
    expect(result.before.theme).toBe(
      String(defaultContent.conferences.find((c) => c.slug === '/2026')?.accentColor),
    );
    expect(result.after.title).toBe('Speak Boldly');
    expect(result.after.theme).toBe('#112233');
  });

  it('save-draft keeps the public read on the published doc until publish', async () => {
    const seed = await seedBody();

    const result = await run(
      Effect.gen(function* () {
        const content = yield* Content.Service;
        const editor = yield* DraftEditor.Service;

        // Save a draft that renames 2026 — public read must NOT see it. The
        // draft is saved AFTER the seeded publish (clock advanced) so it is the
        // strictly-newer pending edit the editor should reopen.
        yield* TestClock.adjust('1 second');
        yield* editor.editDocument(
          siteScope,
          assembleOverrides([['conferences.2.themeName.en', 'Draft Only']]) as Json,
        );

        const publicRead = yield* content.getConference('en', 2026);
        const adminRead = yield* editor.load(siteScope);
        return { publicTitle: publicRead.title, adminSource: adminRead.source };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    // Public read stays on the published document; the editor sees the draft.
    expect(result.publicTitle).toBe('Speak');
    expect(result.adminSource).toBe('draft');
  });
});

describe('CMS image upload → /images/<key> retrieval (in-memory bucket)', () => {
  it('stores raw bytes under images/uploads/<key> and serves them back', async () => {
    const seed = await seedBody();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const storage = yield* Storage.Service;

        // Validate + store the raw upload exactly as the route action does, then
        // rewrite the draft's targeted key via the one service.
        const contentType = 'image/png';
        expect(isAcceptedImageType(contentType)).toBe(true);
        const target = 'team.0.photo.key';
        const key = uploadedImageKey(target, contentType, 1_700_000_000_000);
        yield* storage.put(key, png, contentType);
        // Advance so the draft the rewrite writes is strictly newer than the
        // epoch-seeded published doc and `load` reopens it.
        yield* TestClock.adjust('1 second');
        yield* editor.applyImageUpload(siteScope, target, key);

        // Retrieve through the same `Storage.get` the `GET /images/*` route uses.
        const served = yield* storage.get(key);
        const bytes = new Uint8Array(
          yield* Effect.promise(() =>
            new Response(served.stream).arrayBuffer(),
          ),
        );

        // The reopened draft now references the uploaded key for team member 0.
        const draft = yield* editor.load(siteScope);
        return {
          key,
          servedContentType: served.contentType,
          bytes,
          draftKey: String(draft.content.team[0]?.photo?.key),
        };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    expect(String(result.key)).toBe(
      'images/uploads/team-0-photo-key-1700000000000.png',
    );
    expect(result.servedContentType).toBe('image/png');
    expect([...result.bytes]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(result.draftKey).toBe(result.key);
  });

  it('resolves a managed key to a /images/<key> URL at the Content boundary', async () => {
    const seed = await seedBody();
    const team = await run(
      Effect.gen(function* () {
        const content = yield* Content.Service;
        return yield* content.getTeam();
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );
    expect(team.team[0]?.image).toBe('/images/team/elijah.jpg');
  });
});

/**
 * `DraftEditor.applyListOps` is the route's `list-op` intent target (ADR 0006,
 * registration-launch Branch 2 sub-commit 2.3). It performs an id-keyed
 * add/remove/reorder on the draft and auto-saves it (settled #10), through the
 * same in-memory bucket the public read path uses. These prove the full chain:
 * an "Add" appends an item carrying only its `id` and the DRAFT decodes (so a
 * reload reopens it + a later upload has a target); the SAME draft is
 * publish-INVALID (an empty required field blocks publish, not save); a remove
 * drops the id; the public read is untouched until publish.
 */
const conf2024 = defaultContent.conferences.findIndex((c) => c.slug === '/2024');
const speakers2024 = `conferences.${conf2024}.speakers`;

describe('CMS list-op (add / remove / reorder) via DraftEditor.applyListOps', () => {
  it('add appends an id-only item the DRAFT reopens, but publish rejects it', async () => {
    const seed = await seedBody();
    const newId = newListItemId();

    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const content = yield* Content.Service;

        // Advance so the saved draft is strictly newer than the epoch seed.
        yield* TestClock.adjust('1 second');
        yield* editor.applyListOps(siteScope, [addOp(speakers2024, newId)]);

        // The reopened draft carries the appended stub speaker (id only).
        const draft = yield* editor.load(siteScope);
        const conf = draft.content.conferences.find((c) => c.slug === '/2024');
        const appended = conf?.speakers.at(-1);

        // Publishing the incomplete draft is rejected (ADR 0006): an added item
        // with no bilingual content blocks publish, not the structural save.
        const publishExit = yield* Effect.exit(editor.publish(siteScope));

        // The public read is still the seeded document (no publish went through).
        const publicConf = yield* content.getConference('en', 2024);

        return {
          source: draft.source,
          appendedId: appended === undefined ? undefined : String(appended.id),
          appendedKeys: Object.keys(appended ?? {}),
          publishTag: publishExit._tag,
          publishStatus:
            publishExit._tag === 'Failure'
              ? publishExit.cause.reasons.find((r) => r._tag === 'Fail')
              : undefined,
          publicSpeakerCount: publicConf.speakers.length,
        };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    expect(result.source).toBe('draft');
    expect(result.appendedId).toBe(String(newId));
    expect(result.appendedKeys).toEqual(['id']);
    expect(result.publishTag).toBe('Failure');
    // The public read is unchanged: the seeded 2024 speakers, no extra item.
    expect(result.publicSpeakerCount).toBe(
      defaultContent.conferences[conf2024]?.speakers.length ?? 0,
    );
  });

  it('add → untouched Save draft succeeds (an incomplete item blocks publish, not save)', async () => {
    const seed = await seedBody();
    const newId = newListItemId();

    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;

        yield* TestClock.adjust('1 second');
        // Add a speaker (stub), then the admin hits "Save draft" WITHOUT touching
        // the new item — the form re-submits every rendered field, including the
        // new item's empty `name`/`activity`/`bio`. This must NOT fail
        // (regression: empty strings used to be rejected by the strict boundary).
        yield* editor.applyListOps(siteScope, [addOp(speakers2024, newId)]);
        const ci = conf2024;
        const saveExit = yield* Effect.exit(
          editor.editDocument(siteScope, {
            conferences: defaultContent.conferences.map((c, i) =>
              i === ci
                ? {
                    speakers: [
                      ...defaultContent.conferences[ci]!.speakers.map(() => ({})),
                      { name: { en: '', fr: '' }, activity: { en: '', fr: '' }, bio: { en: '', fr: '' } },
                    ],
                  }
                : {},
            ),
          } as unknown as Json),
        );

        const draft = yield* editor.load(siteScope);
        const conf = draft.content.conferences.find((c) => c.slug === '/2024');
        return {
          saveTag: saveExit._tag,
          hasStub: conf?.speakers.some((s) => String(s.id) === String(newId)),
        };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    expect(result.saveTag).toBe('Success');
    expect(result.hasStub).toBe(true);
  });

  it('add → image upload to the new id succeeds (a present key without alt is draft-valid)', async () => {
    const seed = await seedBody();
    const newId = newListItemId();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const storage = yield* Storage.Service;

        yield* TestClock.adjust('1 second');
        yield* editor.applyListOps(siteScope, [addOp(speakers2024, newId)]);

        // The new speaker is the last one; upload a photo to its id-less
        // positional key path (the upload path is positional in 2.3).
        const ci = conf2024;
        const newIndex = defaultContent.conferences[ci]!.speakers.length;
        const target = `conferences.${ci}.speakers.${newIndex}.photo.key`;
        const key = uploadedImageKey(target, 'image/png', 1_700_000_000_000);
        yield* storage.put(key, png, 'image/png');
        yield* TestClock.adjust('1 second');
        const uploadExit = yield* Effect.exit(
          editor.applyImageUpload(siteScope, target, key),
        );

        const draft = yield* editor.load(siteScope);
        const conf = draft.content.conferences.find((c) => c.slug === '/2024');
        const added = conf?.speakers.at(-1);
        return {
          uploadTag: uploadExit._tag,
          expectedKey: String(key),
          addedKey: added?.photo?.key === undefined ? undefined : String(added.photo.key),
        };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    // The upload to a stub speaker (no alt yet) is accepted by the draft, and the
    // freshly-added speaker now references the uploaded key.
    expect(result.uploadTag).toBe('Success');
    expect(result.addedKey).toBe(result.expectedKey);
  });

  it('remove drops the id; reorder permutes — the draft reopens with the change', async () => {
    const seed = await seedBody();
    const seeded = defaultContent.conferences[conf2024]?.speakers ?? [];
    const firstId = String(seeded[0]?.id);
    const secondId = String(seeded[1]?.id);

    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;

        yield* TestClock.adjust('1 second');
        // Remove the first speaker, then reorder the remaining so the (formerly
        // second) speaker is explicitly first — a permutation by id.
        yield* editor.applyListOps(siteScope, [
          removeOp(speakers2024, seeded[0]!.id),
        ]);
        yield* TestClock.adjust('1 second');
        const remainingIds = seeded.slice(1).map((s) => s.id);
        yield* editor.applyListOps(siteScope, [
          reorderOp(speakers2024, [...remainingIds].reverse()),
        ]);

        const draft = yield* editor.load(siteScope);
        const conf = draft.content.conferences.find((c) => c.slug === '/2024');
        return {
          ids: (conf?.speakers ?? []).map((s) => String(s.id)),
        };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    // The removed id is gone…
    expect(result.ids).not.toContain(firstId);
    // …the surviving speakers are reordered to the reversed permutation, so the
    // formerly-second speaker (the first survivor) is now LAST.
    expect(result.ids).toContain(secondId);
    expect(result.ids.at(-1)).toBe(secondId);
    expect(result.ids).toEqual(
      [...(defaultContent.conferences[conf2024]?.speakers ?? [])]
        .slice(1)
        .map((s) => String(s.id))
        .reverse(),
    );
  });
});

import { describe, expect, it } from 'bun:test';
import { Effect, Layer, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { Content, SITE_CONTENT_KEY } from '../content.server';
import { Storage } from '../storage.server';
import { layerTest } from '../storage.test-helper';
import {
  assembleOverrides,
  imageUploadTarget,
  isAcceptedImageType,
  uploadedImageKey,
  type Json,
} from './admin-form';
import { DraftEditor, pageScope, siteScope } from './draft-editor.server';
import { defaultContent } from './defaults';
import { addOp, fieldName, removeOp, reorderOp } from './list-edit';
import { defaultAboutPage } from './pages/defaults';
import { pageObjectKey } from './pages/registry';
import { AboutPage } from './pages/schema';
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
          ['conferences./2026.themeName.en', 'Speak Boldly'],
          ['conferences./2026.accentColor', '#112233'],
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
          assembleOverrides([['conferences./2026.themeName.en', 'Draft Only']]) as Json,
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
        // The upload target addresses team member 0 by its `id` (ADR 0006), not
        // by array position.
        const member0Id = String(defaultContent.team[0]?.id);
        const target = `team.${member0Id}.photo.key`;
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

    // The key is namespaced under images/uploads/ with the id-keyed target
    // slugified and the millisecond seed appended (collision-free).
    expect(String(result.key)).toMatch(
      /^images\/uploads\/team-[A-Za-z0-9-]+-photo-key-1700000000000\.png$/,
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
// The list path addresses the 2024 conference by its `slug` identity (ADR 0006,
// sub-commit 2.4), not by array position.
const speakers2024 = `conferences./2024.speakers`;

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
        // new item's empty `name`/`activity`/`bio`, named by the new speaker's
        // **id** (ADR 0006, sub-commit 2.4). This must NOT fail (regression: empty
        // strings used to be rejected by the strict boundary). `assembleOverrides`
        // + `fieldName` reproduces exactly the override the migrated id-keyed view
        // submits.
        yield* editor.applyListOps(siteScope, [addOp(speakers2024, newId)]);
        const saveExit = yield* Effect.exit(
          editor.editDocument(
            siteScope,
            assembleOverrides([
              [fieldName(speakers2024, newId, 'name.en'), ''],
              [fieldName(speakers2024, newId, 'name.fr'), ''],
              [fieldName(speakers2024, newId, 'activity.en'), ''],
              [fieldName(speakers2024, newId, 'activity.fr'), ''],
              [fieldName(speakers2024, newId, 'bio.en'), ''],
              [fieldName(speakers2024, newId, 'bio.fr'), ''],
            ]) as Json,
          ),
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

        // Upload a photo to the new speaker by its **id** (ADR 0006, sub-commit
        // 2.4): the upload target is id-keyed, so `setAtPath` rewrites the key on
        // the matching item regardless of its current list position.
        const target = fieldName(speakers2024, newId, 'photo.key');
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

  it('add → fill EVERY required field (incl. photo.alt + position) → publish SUCCEEDS', async () => {
    // The add→fill→publish loop (settled #10): an added item carrying only its
    // `id` is publish-INVALID, but once the admin fills every field strict
    // `SiteContent` requires it must publish cleanly and go live. This proves the
    // admin view renders a fill surface for ALL required fields — `Speaker`'s
    // bilingual `photo.alt`, and `TeamMember`'s `position` enum + bilingual
    // `photo.alt` — not just the ones the draft-editor baseline exposed. Without
    // those surfaces a freshly-added visible item could save forever but never
    // pass the strict publish gate from the UI.
    const seed = await seedBody();
    const speakerId = newListItemId();
    const memberId = newListItemId();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const content = yield* Content.Service;
        const storage = yield* Storage.Service;

        yield* TestClock.adjust('1 second');
        // Add a brand-new speaker (to 2024) and a brand-new team member — each an
        // id-only stub, exactly as the "Add" buttons do.
        yield* editor.applyListOps(siteScope, [
          addOp(speakers2024, speakerId),
          addOp('team', memberId),
        ]);

        // Upload a photo to each new item by its id (the `…photo.key` rewrite the
        // ImageUpload control performs), so both items reference a real bucket key.
        const speakerKeyPath = fieldName(speakers2024, speakerId, 'photo.key');
        const speakerKey = uploadedImageKey(speakerKeyPath, 'image/png', 1_700_000_000_000);
        yield* storage.put(speakerKey, png, 'image/png');
        const memberKeyPath = fieldName('team', memberId, 'photo.key');
        const memberKey = uploadedImageKey(memberKeyPath, 'image/png', 1_700_000_000_001);
        yield* storage.put(memberKey, png, 'image/png');
        yield* TestClock.adjust('1 second');
        yield* editor.applyImageUpload(siteScope, speakerKeyPath, speakerKey);
        yield* TestClock.adjust('1 second');
        yield* editor.applyImageUpload(siteScope, memberKeyPath, memberKey);

        // Fill EVERY remaining required field the admin view now renders —
        // speaker name/activity/bio + photo.alt (bilingual), team member name +
        // position (enum) + photo.alt (bilingual). This is exactly the override
        // `assembleOverrides` builds from the migrated id-keyed form.
        yield* TestClock.adjust('1 second');
        const fillExit = yield* Effect.exit(
          editor.editDocument(
            siteScope,
            assembleOverrides([
              [fieldName(speakers2024, speakerId, 'name.en'), 'New Speaker'],
              [fieldName(speakers2024, speakerId, 'name.fr'), 'Nouveau conférencier'],
              [fieldName(speakers2024, speakerId, 'activity.en'), 'Plenary'],
              [fieldName(speakers2024, speakerId, 'activity.fr'), 'Plénière'],
              [fieldName(speakers2024, speakerId, 'bio.en'), 'A bio.'],
              [fieldName(speakers2024, speakerId, 'bio.fr'), 'Une bio.'],
              [fieldName(speakers2024, speakerId, 'photo.alt.en'), 'New Speaker'],
              [fieldName(speakers2024, speakerId, 'photo.alt.fr'), 'Nouveau conférencier'],
              [fieldName('team', memberId, 'name'), 'New Member'],
              [fieldName('team', memberId, 'position'), 'team.position.secretary'],
              [fieldName('team', memberId, 'photo.alt.en'), 'New Member'],
              [fieldName('team', memberId, 'photo.alt.fr'), 'Nouveau membre'],
            ]) as Json,
          ),
        );

        // The now-complete draft publishes cleanly…
        const publishExit = yield* Effect.exit(editor.publish(siteScope));

        // …and the public read reflects both new items with NO redeploy.
        const publicConf = yield* content.getConference('en', 2024);
        const publicTeam = yield* content.getTeam();

        return {
          fillTag: fillExit._tag,
          publishTag: publishExit._tag,
          publicSpeakerNames: publicConf.speakers.map((s) => s.name),
          publicTeamNames: publicTeam.team.map((m) => m.name),
        };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    expect(result.fillTag).toBe('Success');
    expect(result.publishTag).toBe('Success');
    // Both freshly-added, fully-filled items are now live on the public read.
    expect(result.publicSpeakerNames).toContain('New Speaker');
    expect(result.publicTeamNames).toContain('New Member');
  });

  it('add → fill name → publish adds a board member to the public read', async () => {
    const seed = await seedBody();
    const boardId = newListItemId();

    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const content = yield* Content.Service;

        yield* TestClock.adjust('1 second');
        yield* editor.applyListOps(siteScope, [addOp('board', boardId)]);

        yield* TestClock.adjust('1 second');
        const fillExit = yield* Effect.exit(
          editor.editDocument(
            siteScope,
            assembleOverrides([
              [fieldName('board', boardId, 'name'), 'New Board Member'],
            ]) as Json,
          ),
        );

        const publishExit = yield* Effect.exit(editor.publish(siteScope));
        const publicTeam = yield* content.getTeam();

        return {
          fillTag: fillExit._tag,
          publishTag: publishExit._tag,
          publicBoardNames: publicTeam.board,
        };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    expect(result.fillTag).toBe('Success');
    expect(result.publishTag).toBe('Success');
    expect(result.publicBoardNames).toContain('New Board Member');
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

/**
 * The per-Page `/admin` editor (registration-launch Branch 5.5, ADR 0008) drives
 * the SAME `DraftEditor` the site editor does, just scoped to a page via
 * `pageScope(id)`. These prove the per-page write path end-to-end against the
 * in-memory bucket:
 *   - "Add item" on a page list appends an id-only stub the page's laxer DRAFT
 *     schema reopens (settled #10), yet publish REJECTS it until filled (ADR 0006);
 *   - filling every required field then publishing makes the page live on the next
 *     `getPage` read with NO redeploy;
 *   - publishing a page busts ONLY that page's read cache — another page (and the
 *     conference `site` doc) is untouched (ADR 0008's per-object isolation).
 */
const faqScope = pageScope('faq');
const faqItems = 'items';

describe('per-page /admin editor via DraftEditor (page scope, ADR 0008/0006)', () => {
  it('add → fill question+answer → publish makes the FAQ page live (no redeploy)', async () => {
    const newId = newListItemId();

    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const content = yield* Content.Service;

        // The FAQ page has no bucket object yet — the editor opens on the bundled
        // default (the same `getPage` fallback the public read uses).
        const opened = yield* editor.load(faqScope);

        // "Add a question" appends an id-only stub; the DRAFT (laxer `DraftFaqPage`)
        // reopens it, but publishing the incomplete page is rejected (the new item
        // has no bilingual question/answer — publish-invalid, ADR 0006).
        yield* TestClock.adjust('1 second');
        yield* editor.applyListOps(faqScope, [addOp(faqItems, newId)]);
        const stub = yield* editor.load(faqScope);
        const stubItem = stub.content.items.find((i) => String(i.id) === String(newId));
        const publishStubExit = yield* Effect.exit(editor.publish(faqScope));

        // Fill the new item's required bilingual question + a one-token answer (the
        // override a fill-form submits), then publish — now it goes live.
        yield* TestClock.adjust('1 second');
        const fillExit = yield* Effect.exit(
          editor.editDocument(faqScope, {
            items: {
              [String(newId)]: {
                question: { en: 'New question?', fr: 'Nouvelle question ?' },
                answer: [
                  { _tag: 'text', value: { en: 'An answer.', fr: 'Une réponse.' } },
                ],
              },
            },
          } as Json),
        );
        const publishExit = yield* Effect.exit(editor.publish(faqScope));

        // The public read reflects the new item with no TTL advance / redeploy.
        const live = yield* content.getPage('faq');

        return {
          openedSource: opened.source,
          stubKeys: Object.keys(stubItem ?? {}),
          publishStubTag: publishStubExit._tag,
          fillTag: fillExit._tag,
          publishTag: publishExit._tag,
          liveQuestions: live.items.map((i) => i.question.en),
        };
      }),
    );

    expect(result.openedSource).toBe('defaults');
    // The appended stub carries ONLY its id (draft-valid, publish-invalid).
    expect(result.stubKeys).toEqual(['id']);
    expect(result.publishStubTag).toBe('Failure');
    expect(result.fillTag).toBe('Success');
    expect(result.publishTag).toBe('Success');
    expect(result.liveQuestions).toContain('New question?');
  });

  it('editing a FAQ item is visible on the next read but does NOT bust About', async () => {
    // Seed a published About page so its cache can be primed and then asserted
    // untouched after a FAQ publish (ADR 0008 per-object isolation).
    const aboutBody = await Effect.runPromise(
      Schema.encodeUnknownEffect(Schema.fromJsonString(AboutPage))(defaultAboutPage),
    );

    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const content = yield* Content.Service;

        // Prime both caches with a read.
        const aboutBefore = yield* content.getPage('about');
        yield* content.getPage('faq');

        // Edit the FIRST seeded FAQ question by its id and publish.
        const faq = yield* editor.load(faqScope);
        const firstId = faq.content.items[0]?.id;
        yield* TestClock.adjust('1 second');
        yield* editor.editDocument(faqScope, {
          items: {
            [String(firstId)]: {
              question: { en: 'Edited?', fr: 'Modifié ?' },
            },
          },
        } as Json);
        yield* editor.publish(faqScope);

        // FAQ reflects the edit on the next read; About is the SAME cached
        // reference (its cache was never busted by the FAQ publish).
        const faqAfter = yield* content.getPage('faq');
        const aboutAfter = yield* content.getPage('about');

        return {
          faqEdited: faqAfter.items[0]?.question.en,
          aboutSameRef: aboutBefore === aboutAfter,
        };
      }),
      { [pageObjectKey('about')]: { body: aboutBody } },
    );

    expect(result.faqEdited).toBe('Edited?');
    // About's cache survived the FAQ publish — per-object isolation holds.
    expect(result.aboutSameRef).toBe(true);
  });

  it('upload:groupPhoto.key stores bytes + rewrites the team draft key (REUSED applyImageUpload)', async () => {
    const teamScope = pageScope('team');
    // The same `upload:<keyPath>` intent the ImageUpload control posts; the route
    // derives the target via `imageUploadTarget`, mirroring `content.tsx`.
    const target = imageUploadTarget('upload:groupPhoto.key');
    expect(target).toBe('groupPhoto.key');

    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const contentType = 'image/jpeg';
    expect(isAcceptedImageType(contentType)).toBe(true);

    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const storage = yield* Storage.Service;

        const key = uploadedImageKey(target!, contentType, 1_700_000_000_000);
        yield* storage.put(key, jpg, contentType);
        // The team page has no bucket object yet — it opens on the bundled default
        // (which OMITS the image). The upload lands the key BEFORE any alt text,
        // proving the lax `DraftTeamPage` tolerance (key without alt).
        yield* editor.applyImageUpload(teamScope, target!, key);

        const draft = yield* editor.load(teamScope);
        const served = yield* storage.get(key);
        const bytes = new Uint8Array(
          yield* Effect.promise(() => new Response(served.stream).arrayBuffer()),
        );
        return {
          key,
          draftKey: String(draft.content.groupPhoto?.key),
          draftAlt: draft.content.groupPhoto?.alt,
          bytes,
        };
      }),
    );

    expect(String(result.key)).toMatch(
      /^images\/uploads\/groupPhoto-key-1700000000000\.jpg$/,
    );
    expect(result.draftKey).toBe(result.key);
    // Key landed with NO alt yet — the upload-first / fill-alt-second flow.
    expect(result.draftAlt).toBeUndefined();
    expect([...result.bytes]).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  });

  it('a plain Team save (no image uploaded) PUBLISHES — keyless alt slots pruned', async () => {
    // The editor ALWAYS renders both image slots' alt `Bilingual` inputs, so a
    // plain save posts `groupPhoto.alt`/`portrait.alt` with NO key. Before the
    // prune that produced a present-but-keyless image object — draft-valid but
    // publish-INVALID (`groupPhoto.key: Missing key`), so the admin could not
    // publish the team page without uploading BOTH images. This drives the real
    // editDocument → publish path and asserts publish SUCCEEDS with both slots
    // section-skipped.
    const teamScope = pageScope('team');
    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const content = yield* Content.Service;
        const override = assembleOverrides([
          ['subtitle.en', 'The team subtitle'],
          ['subtitle.fr', 'Le sous-titre'],
          ['boardHeading.en', 'Board of Directors'],
          ['boardHeading.fr', "Conseil d'administration"],
          ['groupPhoto.alt.en', ''],
          ['groupPhoto.alt.fr', ''],
          ['portrait.alt.en', ''],
          ['portrait.alt.fr', ''],
        ]) as Json;
        yield* TestClock.adjust('1 second');
        yield* editor.editDocument(teamScope, override);
        const publishExit = yield* Effect.exit(editor.publish(teamScope));
        const live = yield* content.getPage('team');
        return {
          publishTag: publishExit._tag,
          subtitleEn: live.subtitle.en,
          groupPhoto: live.groupPhoto,
          portrait: live.portrait,
        };
      }),
    );
    expect(result.publishTag).toBe('Success');
    expect(result.subtitleEn).toBe('The team subtitle');
    // Both image slots stay absent (section-skip), not present-but-keyless.
    expect(result.groupPhoto).toBeUndefined();
    expect(result.portrait).toBeUndefined();
  });

  it('upload key → fill alt → PUBLISH: the alt lands on the existing image', async () => {
    // Once an image IS uploaded (draft carries `key`), the alt override is kept
    // (NOT pruned) so the upload-first / fill-alt-second flow completes through a
    // strict publish.
    const teamScope = pageScope('team');
    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const content = yield* Content.Service;
        const storage = yield* Storage.Service;

        const key = uploadedImageKey(
          'groupPhoto.key',
          'image/jpeg',
          1_700_000_000_000,
        );
        yield* storage.put(
          key,
          new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
          'image/jpeg',
        );
        yield* TestClock.adjust('1 second');
        yield* editor.applyImageUpload(teamScope, 'groupPhoto.key', key);

        // Fill the alt + chrome (the alt override carries NO key — it must merge
        // onto the just-uploaded key, not be pruned).
        yield* TestClock.adjust('1 second');
        yield* editor.editDocument(
          teamScope,
          assembleOverrides([
            ['subtitle.en', 'Sub'],
            ['subtitle.fr', 'Sous'],
            ['boardHeading.en', 'Board'],
            ['boardHeading.fr', 'Conseil'],
            ['groupPhoto.alt.en', 'The 2022 group photo'],
            ['groupPhoto.alt.fr', 'La photo de groupe 2022'],
            ['portrait.alt.en', ''],
            ['portrait.alt.fr', ''],
          ]) as Json,
        );
        const publishExit = yield* Effect.exit(editor.publish(teamScope));
        const live = yield* content.getPage('team');
        return {
          publishTag: publishExit._tag,
          groupPhotoKey: String(live.groupPhoto?.key),
          groupPhotoAltEn: live.groupPhoto?.alt.en,
          portrait: live.portrait,
        };
      }),
    );
    expect(result.publishTag).toBe('Success');
    expect(result.groupPhotoKey).toBe(
      'images/uploads/groupPhoto-key-1700000000000.jpg',
    );
    expect(result.groupPhotoAltEn).toBe('The 2022 group photo');
    // The portrait (keyless on both base + override) is still section-skipped.
    expect(result.portrait).toBeUndefined();
  });

  // The route-level 400 guards (empty file / non-image MIME) are driven against
  // the REAL action in `app/routes/admin/pages.$page.action.test.ts`; here we
  // only pin the intent→target derivation the upload branch keys off.
  it('imageUploadTarget fires only for the upload: intent (else save/publish)', () => {
    expect(imageUploadTarget('save-draft')).toBeNull();
    expect(imageUploadTarget('publish')).toBeNull();
    expect(imageUploadTarget('upload:portrait.key')).toBe('portrait.key');
    expect(imageUploadTarget('upload:groupPhoto.key')).toBe('groupPhoto.key');
  });

  // --- Home page's NESTED mission.photo image slot (Feature A remediation) -----
  // Mirrors the Team image-slot tests above, but the slot lives one level under
  // `mission` and the bundled default SEEDS it (`main/people.png`) — so the
  // section-skip / keyless-prune assertions differ where the seed makes them.

  it('the seeded home mission photo reads through to the public Content boundary', async () => {
    // The default `home` page seeds `mission.photo` = `main/people.png` so the
    // day-one render matches the pre-migration hardcoded `<img>`. Proven here by
    // reading the page with no bucket object (the bundled default) and asserting
    // the projected slot resolves to the managed `/images/main/people.png` URL.
    const result = await run(
      Effect.gen(function* () {
        const content = yield* Content.Service;
        const live = yield* content.getPage('home');
        return { key: String(live.mission.photo?.key), alt: live.mission.photo?.alt };
      }),
    );
    expect(result.key).toBe('main/people.png');
    expect(result.alt).toEqual({ en: 'Mission', fr: 'Mission' });
  });

  it('upload:mission.photo.key rewrites the NESTED home draft key (REUSED applyImageUpload)', async () => {
    const homeScope = pageScope('home');
    // The same generic `upload:<keyPath>` intent — `setPath` navigates the nested
    // `mission.photo.key` exactly as it does the top-level `groupPhoto.key`.
    const target = imageUploadTarget('upload:mission.photo.key');
    expect(target).toBe('mission.photo.key');

    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const storage = yield* Storage.Service;
        const key = uploadedImageKey(target!, 'image/jpeg', 1_700_000_000_000);
        yield* storage.put(key, jpg, 'image/jpeg');
        yield* editor.applyImageUpload(homeScope, target!, key);
        const draft = yield* editor.load(homeScope);
        const mission = draft.content.mission as { photo?: { key?: string } };
        return { key, draftKey: String(mission.photo?.key) };
      }),
    );
    expect(String(result.key)).toMatch(
      /^images\/uploads\/mission-photo-key-1700000000000\.jpg$/,
    );
    // The uploaded key replaced the seeded `main/people.png` at the nested path.
    expect(result.draftKey).toBe(String(result.key));
  });

  // A `home.json` PUBLISHED before `mission.photo` existed — a `mission` with NO
  // `photo` key, exactly what a pre-field publish wrote. Used to prove the
  // read-boundary backfill on BOTH the public read and the /admin draft read.
  const legacyHomeJson = JSON.stringify({
    enabled: true,
    tagline: { en: 'Legacy tagline', fr: 'Ancien slogan' },
    mission: { readStoryLabel: { en: 'Read', fr: 'Lire' } },
    join: {
      title: { en: 'Join', fr: 'Rejoignez' },
      subtitle: { en: 'Sub', fr: 'Sous' },
      donateLabel: { en: 'Donate', fr: 'Donner' },
      volunteerLabel: { en: 'Volunteer', fr: 'Bénévole' },
    },
    newsletter: {
      title: { en: 'News', fr: 'Infos' },
      subtitle: { en: 'NSub', fr: 'NSous' },
      socials: { en: 'Follow', fr: 'Suivez' },
    },
  });

  it('a LEGACY published home.json (no mission.photo) is backfilled to the seeded photo on the PUBLIC read', async () => {
    // It decodes cleanly (the field is optional), so `getPage` returns it as-is and
    // the seeded default NEVER applies — the photo would silently vanish. The
    // read-boundary backfill (`spec.normalize`) fills the absent slot with the
    // seed, so the public view still shows the photo with no migration/redeploy.
    const result = await run(
      Effect.gen(function* () {
        const content = yield* Content.Service;
        const live = yield* content.getPage('home');
        return {
          taglineEn: live.tagline.en, // proves the LEGACY object is what was read
          photoKey: String(live.mission.photo?.key),
          photoAlt: live.mission.photo?.alt,
        };
      }),
      { [pageObjectKey('home')]: { body: legacyHomeJson } },
    );
    // The legacy object was read (its tagline), AND its absent photo was backfilled.
    expect(result.taglineEn).toBe('Legacy tagline');
    expect(result.photoKey).toBe('main/people.png');
    expect(result.photoAlt).toEqual({ en: 'Mission', fr: 'Mission' });
  });

  it('a LEGACY published home.json opens in the /admin editor WITH the seeded photo (draft-read backfill)', async () => {
    // The --deep review's High: the backfill ran on the PUBLIC read but NOT the
    // DraftEditor draft read (`objectCodec.fromBucket`), so the editor opened the
    // slot empty on a legacy doc. With `normalize` now applied there too, the editor
    // sees the seeded photo — so the admin doesn't unknowingly publish it away.
    const homeScope = pageScope('home');
    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const draft = yield* editor.load(homeScope);
        const mission = draft.content.mission as {
          photo?: { key?: string; alt?: unknown };
        };
        return { photoKey: String(mission.photo?.key), photoAlt: mission.photo?.alt };
      }),
      { [pageObjectKey('home')]: { body: legacyHomeJson } },
    );
    expect(result.photoKey).toBe('main/people.png');
    expect(result.photoAlt).toEqual({ en: 'Mission', fr: 'Mission' });
  });

  it('a plain save on a LEGACY home.json through the editor PUBLISHES and KEEPS the seeded photo', async () => {
    // The end-to-end of the --deep High: open a legacy (photo-less) home.json, do a
    // plain save (posts keyless mission.photo.alt), publish. Before the draft-read
    // backfill, the base had no key → the prune dropped the alt → publish wrote a
    // photo-less object (the seed lost). Now the draft base carries the backfilled
    // key, so the alt edit MERGES onto it and the published object keeps the photo.
    const homeScope = pageScope('home');
    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const content = yield* Content.Service;
        const override = assembleOverrides([
          ['tagline.en', 'New tagline'],
          ['tagline.fr', 'Nouveau slogan'],
          ['mission.readStoryLabel.en', 'Read'],
          ['mission.readStoryLabel.fr', 'Lire'],
          ['mission.photo.alt.en', 'Edited alt'],
          ['mission.photo.alt.fr', 'Alt modifié'],
          ['join.title.en', 'Join'],
          ['join.title.fr', 'Rejoignez'],
          ['join.subtitle.en', 'Sub'],
          ['join.subtitle.fr', 'Sous'],
          ['join.donateLabel.en', 'Donate'],
          ['join.donateLabel.fr', 'Donner'],
          ['join.volunteerLabel.en', 'Volunteer'],
          ['join.volunteerLabel.fr', 'Bénévole'],
          ['newsletter.title.en', 'News'],
          ['newsletter.title.fr', 'Infos'],
          ['newsletter.subtitle.en', 'NSub'],
          ['newsletter.subtitle.fr', 'NSous'],
          ['newsletter.socials.en', 'Follow'],
          ['newsletter.socials.fr', 'Suivez'],
        ]) as Json;
        yield* TestClock.adjust('1 second');
        yield* editor.editDocument(homeScope, override);
        const publishExit = yield* Effect.exit(editor.publish(homeScope));
        const live = yield* content.getPage('home');
        return {
          publishTag: publishExit._tag,
          photoKey: String(live.mission.photo?.key),
          photoAltEn: live.mission.photo?.alt.en,
        };
      }),
      { [pageObjectKey('home')]: { body: legacyHomeJson } },
    );
    expect(result.publishTag).toBe('Success');
    // The seeded key survived the plain save; the alt edit landed on it.
    expect(result.photoKey).toBe('main/people.png');
    expect(result.photoAltEn).toBe('Edited alt');
  });

  it('a plain home save (no upload) PUBLISHES and KEEPS the seeded photo', async () => {
    // The home editor always renders the mission.photo alt `Bilingual`, so a plain
    // save posts `mission.photo.alt.en/.fr` with NO key. Unlike Team (whose default
    // is keyless → pruned to absent), home's DEFAULT carries a key, so the prune
    // KEEPS the alt override (it merges onto the seeded key) and publish succeeds
    // with the photo intact — the keyless-prune must not clobber a seeded slot.
    const homeScope = pageScope('home');
    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const content = yield* Content.Service;
        const override = assembleOverrides([
          ['tagline.en', 'A movement'],
          ['tagline.fr', 'Un mouvement'],
          ['mission.readStoryLabel.en', 'Read our story'],
          ['mission.readStoryLabel.fr', 'Lire notre histoire'],
          ['mission.photo.alt.en', 'Our mission'],
          ['mission.photo.alt.fr', 'Notre mission'],
          ['join.title.en', 'Join'],
          ['join.title.fr', 'Rejoignez'],
          ['join.subtitle.en', 'Sub'],
          ['join.subtitle.fr', 'Sous'],
          ['join.donateLabel.en', 'Donate'],
          ['join.donateLabel.fr', 'Donner'],
          ['join.volunteerLabel.en', 'Volunteer'],
          ['join.volunteerLabel.fr', 'Bénévole'],
          ['newsletter.title.en', 'News'],
          ['newsletter.title.fr', 'Infos'],
          ['newsletter.subtitle.en', 'NSub'],
          ['newsletter.subtitle.fr', 'NSous'],
          ['newsletter.socials.en', 'Follow'],
          ['newsletter.socials.fr', 'Suivez'],
        ]) as Json;
        yield* TestClock.adjust('1 second');
        yield* editor.editDocument(homeScope, override);
        const publishExit = yield* Effect.exit(editor.publish(homeScope));
        const live = yield* content.getPage('home');
        return {
          publishTag: publishExit._tag,
          photoKey: String(live.mission.photo?.key),
          photoAltEn: live.mission.photo?.alt.en,
          taglineEn: live.tagline.en,
        };
      }),
    );
    expect(result.publishTag).toBe('Success');
    expect(result.taglineEn).toBe('A movement');
    // Seeded key preserved; the alt edit landed onto it (NOT pruned away).
    expect(result.photoKey).toBe('main/people.png');
    expect(result.photoAltEn).toBe('Our mission');
  });
});

**BLOCKING**

1. **Publish can drop the just-submitted edit on same-second storage timestamps.**  
   Files: `/Users/cvr/Developer/personal/gyc/app/routes/admin/content.tsx:187`, `/Users/cvr/Developer/personal/gyc/app/routes/admin/content.tsx:198`, `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:314`, `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:226`, `/Users/cvr/Developer/personal/gyc/docs/.counsel/draft-editor-WHOLE.diff:1391`, `/Users/cvr/Developer/personal/gyc/docs/.counsel/draft-editor-WHOLE.diff:1446`  
   Old publish wrote the freshly decoded `json` directly to `SITE_CONTENT_KEY`. New publish does `editDocument(...)` then `publish(...)`, but `publish` calls `load(scope)`, which ignores a draft unless its `lastModified` is strictly greater than published. On second-granularity backends, the just-saved draft can compare equal and `publish` republishes the old live doc, then deletes the draft. Tests mask this with `TestClock.adjust('1 second')` at `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.test.ts:315` and `/Users/cvr/Developer/personal/gyc/app/lib/content/cms-e2e.test.ts:81`.  
   Fix: make `publish(scope)` promote the draft object directly, or publish the canonical document returned/produced by `editDocument`, while keeping strict `>` only for editor-open reconciliation. Add a no-clock-advance regression test.

2. **`DraftEditor.defaultLayer` is dead and hazardous.**  
   Files: `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:343`, `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:353`, `/Users/cvr/Developer/personal/gyc/app/lib/effect/runtime.ts:75`  
   `defaultLayer` has no caller; runtime correctly wires `DraftEditor.layer` over `BaseLayer`. Worse, `defaultLayer` pre-provides its own `Content.layer`/`Storage.layerOptional`, which is exactly the kind of parallel service graph the runtime avoids so `publish` busts the public read cache. This violates the branch’s subtract/delete discipline.  
   Fix: delete `DraftEditor.defaultLayer` and its comment. Keep the runtime’s explicit `DraftEditor.layer.pipe(Layer.provideMerge(BaseLayer), ...)` wiring.

3. **The promised edit-equivalence corpus is not there.**  
   Files: `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:51`, `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.test.ts:204`  
   The plan requires an edit corpus proving extraction equivalence. The test has one happy-path theme-name edit plus one reject case. It does not cover translation keys with dots, numeric coercions, nested hero keys, team fields, preserved `Option` registration data, or same-second publish behavior.  
   Fix: add table-driven corpus tests that compare the new service output against a test-local reproduction of the deleted inline algorithm: encode current, assemble/collect, deep-merge, decode, Schema JSON encode. Include the same-second publish regression above.

**Concerns**

- **`IssueError.status` leaks HTTP transport into the editor service.**  
  Files: `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:86`, `/Users/cvr/Developer/personal/gyc/app/routes/admin/content.tsx:70`  
  This is not the main blocker, but cleaner boundary discipline would make `IssueError` a domain/admin-write error variant (`ValidationRejected`, `StorageWriteFailed`) and let the route map variants to HTTP status.

**Passed Checks**

The closed `ContentScope` and `scopeKeys` are implemented as planned at `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:56` and `:72`. The route no longer imports leaked bucket constants and delegates write operations through `DraftEditor` at `/Users/cvr/Developer/personal/gyc/app/routes/admin/content.tsx:15` and `:161`. `Content.getAdminContent` is deleted from the current `Content.Service` surface at `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:316`. `AssetKey.make` looks safe for legitimate uploads: produced keys satisfy the filter in `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:58` via `/Users/cvr/Developer/personal/gyc/app/lib/content/admin-form.ts:106`. The `as Json` / `as EncodedDoc` casts are boundary encode coercions, not `any` masking.

I did not run the gate; this was a static whole-PR review from the supplied diff and current files in a read-only sandbox.

**Files Consulted**

`/Users/cvr/Developer/personal/gyc/docs/.counsel/out-draft-editor-WHOLE/personal-gyc-42088828/20260617-134916-claude-to-codex-06a410/prompt.md`  
`/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`  
`/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md`  
`/Users/cvr/Developer/personal/gyc/CONTEXT.md`  
`/Users/cvr/Developer/personal/gyc/docs/adr/0006-stable-list-item-ids.md`  
`/Users/cvr/Developer/personal/gyc/docs/adr/0007-structural-form-builder.md`  
`/Users/cvr/Developer/personal/gyc/docs/adr/0008-per-page-storage-objects.md`  
`/Users/cvr/Developer/personal/gyc/docs/.counsel/draft-editor-WHOLE.diff`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts`  
`/Users/cvr/Developer/personal/gyc/app/routes/admin/content.tsx`  
`/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/admin-form.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/effect/runtime.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.test.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/cms-e2e.test.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/content.server.test.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/storage.server.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/storage.test-helper.ts`

**Let Me Take More Off Your Plate**

- Next actions I can do right now: patch `publish`, delete `defaultLayer`, add the missing regression/corpus tests.
- Automations or systems I can set up: add a no-clock-advance CMS publish test pattern so timestamp regressions stay caught.
- Things to delegate to your team: ask the branch author to confirm whether `publish(scope)` is intended to publish only an existing draft or also fallback content.
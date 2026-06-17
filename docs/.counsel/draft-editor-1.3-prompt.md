# Codex counsel review — registration-launch Branch 1, sub-commit 1.3

You are doing a STANDARD (not deep) code review of a SINGLE just-landed git commit
against a written plan. Be concrete, cite file:line, and do not re-litigate settled
decisions. Your job is narrow: judge whether THIS ONE commit implements exactly its
assigned slice of the plan — no more, no less — and respects the project's principles.

## What to read

1. The FULL synthesized stacked-PR plan (every branch + sub-commit list) is at:
   `docs/registration-launch-plan.md`
   Read it in full so you understand where 1.3 sits in the stack.

2. The branch this commit belongs to is **Branch 1 — `reg-launch/draft-editor`**
   (plan section "Branch 1 — `reg-launch/draft-editor` (Candidate 3)", lines ~31–61).
   Its module interface is the `DraftEditor` deep module:
   - `editDocument(scope, override): Effect<EncodedDoc, IssueError>`
   - `applyImageUpload(scope, targetPath, key: AssetKey): Effect<EncodedDoc, IssueError>`
   - `publish(scope): Effect<void, IssueError>`
   - `load(scope): Effect<AdminContent, IssueError>`
   `ContentScope` is a closed single-inhabitant union `{ kind: 'site' }` routed through
   `scopeKeys(scope) -> { draftKey, publishedKey }`.

3. THIS commit's diff is at: `docs/.counsel/draft-editor-1.3.diff`
   (commit `68e2300`, files: `app/routes/admin/content.tsx`, `app/lib/content.server.ts`,
   `app/lib/content.server.test.ts`, `app/lib/content/cms-e2e.test.ts`,
   `app/lib/effect/runtime.ts`).

## This commit's assigned slice (sub-commit 1.3)

> **(1.3)** Migrate `admin/content.tsx` action to `DraftEditor`, delete the inline
> ~165-line pipeline + leaked constants.

Sub-commits 1.1 (`ContentScope` + `scopeKeys` + `DraftEditor.load` + tests) and 1.2
(`editDocument` + `applyImageUpload` + `publish` + tests) already landed BEFORE this
commit — they are NOT in this diff and are out of scope for your review. 1.3 is the
*migration + deletion* step: it points the route at the already-built service and
deletes the now-dead inline pipeline.

The plan's "Subtract (what dies)" for Branch 1 (the deletions 1.3 must realize):
- The duplicated ~165-line inline action body in `admin/content.tsx:138-289` →
  replaced by `DraftEditor` calls. ("Deletion test passes: the inline lines genuinely vanish.")
- `Content.getAdminContent` (`content.server.ts:484-515`) → moved into `DraftEditor.load`,
  callers migrated, old method deleted.
- The leaked `SITE_CONTENT_KEY` / `SITE_CONTENT_DRAFT_KEY` imports in the route.

Plan's test surface relevant to this slice:
- `cms-e2e.test.ts` — save draft, publish, upload all pass through the one service;
  route action is auth + `DraftEditor` call only.
- (The extracted-pipeline + `load`-reconciliation tests belong to 1.1/1.2's
  `draft-editor.server.test.ts`; 1.3 should MOVE the old `getAdminContent` tests out of
  `content.server.test.ts`, not duplicate them.)

## Review questions (answer each, with receipts)

1. **Exactly its slice (no more, no less)?** Does 1.3 do only the migration + deletion,
   or does it smuggle in 1.1/1.2 work, or new behavior beyond the plan? Conversely, does
   it leave any of the slice undone?

2. **Honors the module interface?** Does the route now call only `load` / `editDocument` /
   `applyImageUpload` / `publish` through `siteScope`, with the route reduced to
   "auth → parse intent → call DraftEditor → map result to Response"? Any leftover
   pipeline logic (encode/merge/decode/re-encode/store) still inline in the route?

3. **Makes its share of the deletions (`subtract-before-you-add`)?** Are the inline ~165
   lines GENUINELY gone (not commented out, not parallel-kept)? Is `Content.getAdminContent`
   deleted and all callers migrated (`migrate-callers-then-delete-legacy-apis`)? Are the
   leaked `SITE_CONTENT_KEY`/`SITE_CONTENT_DRAFT_KEY` imports + the local decode/encode
   codecs + cause-walking `issueMessages` removed from the route? Is the now-unused
   `ObjectHead` import dropped from `content.server`?

4. **Principle violations?** Check especially: `small-interface-deep-implementation`
   (route is a thin adapter), `boundary-discipline`, `make-impossible-states-unrepresentable`
   (no key-constant leak), `correctness-over-pragmatism` (NO cast-to-any, NO stubs, NO
   commented-out code, NO `as unknown as`). Note any `as`-casts and whether they are
   load-bearing at a real boundary or papering over a type hole.

5. **Test surface for the slice?** Does `cms-e2e.test.ts` drive save-draft / publish /
   upload end-to-end through the one service against the in-memory bucket? Were the old
   `getAdminContent` reconciliation tests correctly MOVED (not lost) when the method was
   deleted? Any behavior the plan requires for THIS slice that is now untested?

6. **Behavior regression?** Does the migrated route preserve the pre-branch behavior:
   same loader output (`document`, `source`, `bucketConfigured`), same action responses
   (400 on validation reject, 502 on storage failure, redirects with status messages),
   same image-upload validation (file present, accepted type, raw-bytes put then draft
   rewrite)? The runtime wiring change in `runtime.ts` (`provideMerge` layering
   `DraftEditor` onto the app BaseLayer so it shares `Content`/`Storage`) — is it correct
   and does it preserve the "publish busts the public read cache" property?

7. **Gate.** The author asserts the gate passes (`bun run typecheck && bun run lint &&
   bun run build && bun test`). Flag anything in the diff that looks like it would break
   typecheck/lint/build/test.

## Output

Give a clear verdict (approve / approve-with-nits / request-changes) and an explicit
list of any BLOCKING issues (must-fix before this commit is sound) separate from
non-blocking concerns. For each, cite file:line. If you find nothing blocking, say so
plainly — do not invent work.

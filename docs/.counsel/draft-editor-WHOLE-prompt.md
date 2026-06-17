# Deep adversarial whole-PR review — `reg-launch/draft-editor` (Branch 1)

You are Codex performing a `--deep`, holistic, adversarial review of an ENTIRE stacked-PR
branch (all its sub-commits assembled), not a single commit. Be skeptical. Your job is to
find where the assembled PR fails to fully realize its plan section, leaves a half-migrated
caller or dead code between slices, regresses behavior, or violates a load-bearing principle.

## What you are reviewing

Branch `draft-editor` (the plan's `reg-launch/draft-editor`, Branch 1) stacked on base
`feature/registration-launch`. It is the FIRST branch of a 7-branch stack that launches GYC
Canada's registration + expands its runtime-read CMS. Its job: extract a deep `DraftEditor`
module that absorbs the inline, duplicated admin write pipeline, so every later admin feature
(list-edit, per-page content, forms) builds on a clean interface instead of churning the route.

Four sub-commits, assembled in the whole-PR diff:
- `0ddcb40` ContentScope + scopeKeys + DraftEditor.load (reconciliation moved from getAdminContent)
- `b7ad48d` editDocument + applyImageUpload + publish
- `68e2300` migrate admin route to DraftEditor, delete inline pipeline
- `b24a7c7` brand uploaded image keys as AssetKey at the producer boundary

## Inputs (read these in full)

1. **The full synthesized plan** (every branch, so you can judge whether Branch 1 sets up
   the stack correctly and doesn't pre-empt or under-build for later branches):
   `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`

2. **The settled brief** (decisions NOT to re-litigate; non-goals NOT to flag as gaps):
   `/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md`

3. **Domain language + decisions** (realize, don't re-open):
   `/Users/cvr/Developer/personal/gyc/CONTEXT.md`,
   `/Users/cvr/Developer/personal/gyc/docs/adr/0006-stable-list-item-ids.md`,
   `/Users/cvr/Developer/personal/gyc/docs/adr/0007-structural-form-builder.md`,
   `/Users/cvr/Developer/personal/gyc/docs/adr/0008-per-page-storage-objects.md`

4. **The whole-PR diff** (Branch 1, all four sub-commits, vs the base branch merge-base):
   `/Users/cvr/Developer/personal/gyc/docs/.counsel/draft-editor-WHOLE.diff`

5. **The full current files** (read these from the repo for context the diff omits):
   - `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts` (the new module)
   - `/Users/cvr/Developer/personal/gyc/app/routes/admin/content.tsx` (the migrated route)
   - `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts` (getAdminContent deleted from here)
   - `/Users/cvr/Developer/personal/gyc/app/lib/content/admin-form.ts` (uploadedImageKey → AssetKey)
   - `/Users/cvr/Developer/personal/gyc/app/lib/effect/runtime.ts` (layer wiring)
   - `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.test.ts`
   - `/Users/cvr/Developer/personal/gyc/app/lib/content/cms-e2e.test.ts`

## The plan section this PR must fully realize

The authoritative spec is **"Branch 1 — `reg-launch/draft-editor` (Candidate 3)"** in the plan
(lines ~31-60). Verbatim obligations to check the assembled PR against:

- **Interface (smallest surface):** `editDocument(scope, override) -> Effect<EncodedDoc, IssueError>`,
  `applyImageUpload(scope, targetPath, key: AssetKey) -> Effect<EncodedDoc, IssueError>`,
  `publish(scope) -> Effect<void, IssueError>`, `load(scope) -> Effect<AdminContent, IssueError>`.
  The route keeps FormData→intent parsing; the module takes a parsed override.
- **`ContentScope` introduced as a closed, single-inhabitant union today** (`{ kind: 'site' }`),
  NOT a free string; everything routes through `scopeKeys(scope): { draftKey, publishedKey }`
  (one case now, N later) so Branch 5 *widens the union* rather than retrofitting a parameter.
  An editor cannot target a key that isn't a known scope.
- **Implementation absorbs:** the ~165 duplicated lines, the double draft-read, the
  assemble/collect/merge/decode/re-encode choreography, the per-scope draft/published
  reconciliation (`load`, moved verbatim from `getAdminContent`, generalized over `scopeKeys`),
  and the bucket-key constants. Route action shrinks to "auth → parse intent → call DraftEditor
  → map result to Response".
- **Read-path:** `Content.getAdminContent` replaced by `DraftEditor.load({ kind: 'site' })`;
  `bust` parameterized over scope (one cache today). Public `getSiteContent` read path untouched.
- **Subtract (deletion test must pass — these must GENUINELY vanish):**
  - the duplicated ~165-line inline action body in `admin/content.tsx` → replaced by DraftEditor calls;
  - `Content.getAdminContent` → moved into `DraftEditor.load` (callers migrated, old method deleted);
  - the leaked `SITE_CONTENT_KEY`/`SITE_CONTENT_DRAFT_KEY` imports in the route.
- **Test surface:** `draft-editor.server.test.ts` (edit→merge→decode→re-encode equivalence on an
  edit corpus proving extraction is behavior-preserving; image-upload path; `load` reconciliation:
  draft-newer / draft-older / draft-no-published / defaults, ported from getAdminContent tests).
  `cms-e2e.test.ts`: save draft, publish, upload all pass through the one service.
- **Sub-commit slicing:** (1.1) scope+scopeKeys+load+tests; (1.2) editDocument+applyImageUpload+
  publish+tests; (1.3) migrate route, delete inline pipeline + leaked constants. (The AssetKey
  branding is a 4th follow-up commit landing the plan's `key: AssetKey` interface.)

## What I need from you — holistic, adversarial

Judge the **assembled** PR, not commit-by-commit. Specifically:

1. **Plan realization.** Does every obligation above actually land? Is the interface as DEEP as
   claimed (small surface hiding the whole choreography), or did complexity leak back to the route?
   Are ALL the deletions made (inline pipeline, getAdminContent, leaked constants) — run the
   deletion test mentally: is any of it still present, dead, or duplicated?

2. **Cross-slice coherence.** Does the PR cohere across its four sub-commits? Any half-migrated
   caller (something still calling the old `getAdminContent` or re-implementing the inline merge)?
   Any dead code left between slices (e.g. an unused export, a helper orphaned by the migration)?
   Specifically scrutinize: is `DraftEditor.defaultLayer` (defined in draft-editor.server.ts) ever
   USED? The app runtime (`runtime.ts`) wires `DraftEditor.layer` directly on top of a shared
   BaseLayer; if `defaultLayer` has no caller, is it dead code that violates
   `migrate-callers-then-delete-legacy-apis` / `subtract-before-you-add`, or is it justified as a
   parallel-to-`Content.defaultLayer` convention? Decide and call it.

3. **Behavior preservation (the riskiest part of THIS branch — scrutinize hardest).** The plan's
   highest-risk claim for Branch 1 is that the extraction is **behavior-preserving** vs the old
   inline path. (Note: the task's generic risk hints — B2 id-backfill, B3 Option→string|undefined,
   B6 equivalence harness — belong to LATER branches and are NOT in this PR; do not look for them
   here. The Branch-1 analogue is the extraction-equivalence + the load reconciliation + the layer
   wiring.) Verify:
   - Does `load`'s draft/published reconciliation match the deleted `getAdminContent` EXACTLY
     (the `lastModified` strict-`>` comparison, the draft-no-published case, the defaults fallback,
     the "never throw — a bad draft is logged and the editor still opens" contract)? Is the
     `head`-based comparison still second-granularity-safe (the strict `>` dropping a same-second
     draft toward the just-published live content)?
   - Does the migrated route's save/publish/upload produce byte-identical bucket writes to the old
     inline path (same canonical JSON via the Schema JSON codec, not `JSON.stringify`)?
   - Is the `Content.bust()` in `publish` busting the SAME cache instance the public read serves
     from? The layer wiring changed from `Layer.mergeAll(...).pipe(provideMerge(Env))` to
     `DraftEditor.layer.pipe(provideMerge(BaseLayer), provideMerge(Env))`. Confirm `DraftEditor`
     consumes the exposed `Content.Service`/`Storage.Service` (so publish busts the live cache and
     reads/writes hit one bucket), with no second Content/Storage instance silently created.
   - The image-upload path moved: the route still validates the file + stores raw bytes, then calls
     `applyImageUpload` to rewrite the key on the draft. Is the ordering safe (bytes stored before
     the draft references the key)? Does `uploadedImageKey` returning a branded `AssetKey` (via
     `AssetKey.make`) ever throw at runtime for a legitimate upload (the slug is `[a-zA-Z0-9-]` +
     `images/uploads/` namespace — is `AssetKey`'s filter actually satisfied by every produced key,
     or could a content-type extension or slug edge-case fail the brand and 500 a real upload)?

4. **Principles.** Check against: small-interface-deep-implementation, make-impossible-states-
   unrepresentable, boundary-discipline, subtract-before-you-add, migrate-callers-then-delete-
   legacy-apis, derive-dont-sync, correctness-over-pragmatism (NO cast-to-any masking a real type
   hole — note the `as Json` / `as EncodedDoc` casts in the module: are they boundary-justified
   encode-result coercions, or are they hiding a genuine type mismatch?). Is `IssueError` carrying
   an HTTP `status` field a clean boundary, or does it smuggle transport concerns into the domain
   error?

5. **Test surface completeness.** Does the test corpus actually PROVE behavior-preservation, or is
   it thin? The plan demanded an "edit corpus" proving equivalence against the old inline path. Is
   there a real corpus, or just one happy-path edit? Are the reject paths (empty required bilingual
   field → 400, no draft written), the stale-draft-ignored case, and the publish-busts-cache case
   all covered? Is anything asserted that the OLD code guaranteed but the new tests dropped?

## Output format

For each finding: severity (**BLOCKING** / concern / nit), the file + location, what's wrong, and
the concrete fix. Separate **BLOCKING** (must fix before this PR merges: plan obligation unmet,
deletion incomplete, dead code between slices, behavior regression, principle violation, untested
boundary) from non-blocking concerns. If the PR fully realizes its plan section and coheres, say so
explicitly and list only residual concerns/nits. Do not invent gaps that the brief lists as
non-goals or that belong to later branches.

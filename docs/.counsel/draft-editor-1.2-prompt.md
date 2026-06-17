# Counsel review — Branch 1 (`reg-launch/draft-editor`), sub-commit 1.2

You are Codex, doing a STANDARD code review of a SINGLE just-landed commit in a stacked-PR
implementation of the GYC registration-launch plan. Review ONLY this one commit against the
plan slice it is supposed to land. Do not redesign the whole branch; do not re-litigate settled
decisions. Judge whether this commit lands EXACTLY its slice — no more, no less.

## What to read

1. **The full synthesized plan** (every branch + sub-commit list):
   `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`
2. **The settled brief** (decisions you must NOT re-open, non-goals, key files):
   `/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md`
3. **This commit's diff** (the ONLY thing under review):
   `/Users/cvr/Developer/personal/gyc/docs/.counsel/draft-editor-1.2.diff`
4. The full module + test files as they stand after this commit (read for context):
   - `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts`
   - `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.test.ts`
   - `/Users/cvr/Developer/personal/gyc/app/lib/content/admin-form.ts` (deepMerge, setAtPath, assembleOverrides)
   - `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts` (Content service, SITE_CONTENT_KEY/DRAFT_KEY, bust)

## The branch's PR-plan section (authoritative for the module interface)

Branch 1 — `reg-launch/draft-editor` (plan §"Branch 1"). The settled module shape:

- New module `app/lib/content/draft-editor.server.ts` exposing the SMALLEST surface; the route
  keeps FormData→intent parsing, the module takes a PARSED override:
  - `editDocument(scope, override): Effect<EncodedDoc, IssueError>` — full
    encode→merge→decode→re-encode→store-draft pipeline as ONE call.
  - `applyImageUpload(scope, targetPath, key): Effect<EncodedDoc, IssueError>`.
  - `publish(scope): Effect<void, IssueError>` — promote draft → published, delete draft, bust cache.
  - `load(scope): Effect<AdminContent, IssueError>` — draft/published reconciliation (landed in 1.1).
- `ContentScope` is a CLOSED single-inhabitant union today (`{ kind: 'site' }`), routed through
  `scopeKeys(scope) → { draftKey, publishedKey }`. Branch 5 widens the union, not retrofits a param.
  `make-impossible-states-unrepresentable`: an editor cannot target a key that isn't a known scope.
- Implementation absorbs: the ~165 duplicated lines, the double draft-read, the
  assembleOverrides/collectTranslations/merge/decode/encode choreography, the per-scope
  reconciliation, and the bucket-key constants. The route action later (1.3) shrinks to
  "auth → parse intent → call DraftEditor → map result to Response".

The branch's sub-commit list:
- (1.1) `ContentScope` + `scopeKeys` + `DraftEditor.load` (reconciliation moved from `getAdminContent`) + tests.
- (1.2) **THIS COMMIT** — `DraftEditor.editDocument` + `applyImageUpload` + `publish` + tests
  (route still calls the old inline pipeline; behavior identical).
- (1.3) Migrate `admin/content.tsx` action to `DraftEditor`, delete the inline ~165-line pipeline + leaked constants.

## This commit under review

- **id:** `b7ad48d` — `refactor(cms)(draft-editor): editDocument + applyImageUpload + publish`
- **intent (sub-commit 1.2):** add the three write operations to `DraftEditor`, each addressed by
  `ContentScope` and routed through `scopeKeys`, with tests proving merge preserves unedited deep
  fields, present-but-empty required field rejects (400), image-key rewrite persists, and publish
  goes live on the next read (busts cache). The route STILL calls the old inline pipeline in this
  commit; behavior is identical (the route migration + deletion is sub-commit 1.3, separate).

## Gate status (already verified green by the implementer)

`bun run typecheck && bun run lint && bun run build && bun test` → 179 pass / 0 fail. The WARN lines
in test output are the intentional "could not read absent draft → logged + ignored" path.

## Review questions — answer each explicitly

1. **Exact slice (no more / no less).** Does this commit implement EXACTLY 1.2's slice — the three
   write ops + their tests — and NOT bleed into 1.3 (route migration / inline-pipeline deletion)?
   The route still calling the old pipeline in this commit is CORRECT per the plan (1.2 says "route
   still calls them; behavior identical"). Flag if it did too much (deleted the route pipeline early)
   or too little (a write op missing, e.g. no `publish`).
2. **`small-interface-deep-implementation` + the stated interface.** Are the three new ops the
   settled signatures (`editDocument(scope, override)`, `applyImageUpload(scope, targetPath, key)`,
   `publish(scope)`)? Is the surface minimal (no leaked bucket keys, no extra public exports the
   plan didn't call for)? Is the depth real (the merge/decode/re-encode/store + double-read + cache-
   bust choreography hidden behind the calls)?
3. **This commit's share of the deletions (`subtract-before-you-add`).** 1.2's share is SMALL: it
   ADDS the write ops; the big deletion (the ~165 inline lines, leaked constants, `getAdminContent`)
   is 1.3 + 1.1. Does this commit avoid leaving a *parallel* second pipeline that 1.3 then has to
   reconcile (`migrate-callers-then-delete-legacy-apis`)? The plan explicitly sequences the route
   migration into 1.3 — confirm 1.2 doesn't prematurely fork a competing path the route uses.
4. **Principle violations.** Check for: `make-impossible-states-unrepresentable` (scope routing,
   no raw-string keys); `boundary-discipline` (decode once, before store; reject carries dotted
   issues); `derive-dont-sync`; `correctness-over-pragmatism` (NO cast-to-any beyond the
   plan-sanctioned `as Json`/`as EncodedDoc` boundary casts, NO stubs, NO commented-out code, NO
   `as unknown as`). Specifically scrutinize: the `Effect.orDie` on encode-after-decode (is "a
   decoded doc always re-encodes, so a failure is a bug not a user error" sound?); the `String(cause)`
   in the 502 message; the `editDocument`/`applyImageUpload` sharing `decodeOrReject` + `storeDraft`.
5. **Test surface the plan requires for THIS slice.** The plan's Branch-1 test surface for the
   write ops: edit→merge→decode→re-encode equivalence (merge preserves unedited deep fields), the
   image-upload path, the publish-goes-live path. Does 1.2's test set cover: (a) merge preserves
   unedited deep fields, (b) present-but-empty required field → 400 reject AND bucket untouched,
   (c) image-key rewrite persists to the draft, (d) publish promotes draft→published + busts cache +
   drops draft? Any required-for-this-slice test missing? (Note: the full edit-corpus equivalence vs
   the OLD inline path is most meaningful once 1.3 deletes the inline path — judge whether 1.2's
   coverage is sufficient for the write ops it introduces.)
6. **Behavior regression.** Does the new pipeline preserve the old inline behavior — same merge
   semantics (`deepMerge`), same decode boundary (`SiteContent`), same canonical re-encode (JSON
   codec, not `JSON.stringify`), same publish semantics (write published, best-effort draft delete,
   bust), same draft/published reconciliation feeding `editDocument`/`publish`'s "current"? Anything
   that would change what gets stored or served vs the pre-branch route?

## Output

Give a clear verdict: BLOCKING issues (must fix before this commit is sound), non-blocking concerns,
and an overall pass/fail for whether 1.2 lands its slice correctly. Cite specific file:line for every
claim (full paths). Be adversarial but precise — do not invent gaps the plan explicitly defers to 1.3
or later branches.

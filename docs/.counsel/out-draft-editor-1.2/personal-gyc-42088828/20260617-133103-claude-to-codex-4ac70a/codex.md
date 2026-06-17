**Verdict: fail pending one small blocking fix.**

**Blocking**
`applyImageUpload` does not land the settled interface exactly. The plan specifies `applyImageUpload(scope, targetPath, key: AssetKey)`, but the service exposes and implements `key: string` instead. That widens the module boundary and lets callers construct an invalid asset-key state that TypeScript could have rejected. The later schema decode does prevent bad data from being stored, so this is not a storage corruption bug, but it is a `make-impossible-states-unrepresentable` / exact-slice interface miss.

Receipts:
`/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:35-41`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:163-167`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:301-310`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:79-82`

**Non-Blocking**
The `String(cause)` text in the 502 messages is weaker than the route’s old `Cause.pretty(...)`-style diagnostics, but I would not block on it. The operation still returns a structured `IssueError` with status `502` and empty field issues.

Receipts:
`/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:276-286`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:320-328`

**Review Questions**
1. Exact slice: yes, except the `AssetKey` signature miss above. Commit `b7ad48d` changes only `draft-editor.server.ts` and `draft-editor.server.test.ts`, so it does not bleed into 1.3. At that commit, `admin/content.tsx` still has the old inline upload/save/publish pipeline.

2. Small interface / deep implementation: mostly yes. `editDocument`, `applyImageUpload`, and `publish` hide load → encode → merge/rewrite → decode → canonical encode → store/publish/cache-bust. Surface is minimal apart from `applyImageUpload` accepting raw `string`.

3. Subtract-before-you-add: acceptable for 1.2. This commit adds the replacement operations and tests while leaving the route migration/deletion to 1.3, exactly as sequenced. No route caller is migrated in this commit.

4. Principle check: scope routing is closed through `ContentScope` and `scopeKeys`; decode happens before storing; `Effect.orDie` after decoding is sound because encode failure would be a programmer/schema bug rather than user input. No `any`, `as unknown as`, stubs, or commented-out fallback paths found in the reviewed diff.

5. Test surface: sufficient for this slice. Tests cover deep-field preservation, present-but-empty required field rejecting with 400 and no draft write, image-key rewrite persisting, and publish promoting draft → published, deleting draft, and busting cache.

6. Behavior regression: no substantive behavior drift found. New code uses the same `deepMerge`, `setAtPath`, `SiteContent` decode boundary, Effect Schema JSON codec, draft/published reconciliation, best-effort draft delete, and `Content.bust()` semantics.

Key receipts:
`/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:72-80`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:248-260`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:289-339`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.test.ts:204-338`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/admin-form.ts:209-237`  
`/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:489-530`  
`/Users/cvr/Developer/personal/gyc/app/routes/admin/content.tsx:138-288` at commit `b7ad48d`

I did not rerun the gate; the prompt supplied a green `bun run typecheck && bun run lint && bun run build && bun test` result, and this was a read-only review.
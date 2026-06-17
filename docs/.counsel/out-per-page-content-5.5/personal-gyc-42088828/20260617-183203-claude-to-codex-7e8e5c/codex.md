**Verdict: request-changes**

Blocking items:

1. `/admin/pages/faq` exposes “+ Add question”, but the route cannot make the new item publishable. `FaqPage` strictly requires `answer: RichText` ([schema.ts](/Users/cvr/Developer/personal/gyc/app/lib/content/pages/schema.ts:167)), `DraftFaqPage` only makes `answer` optional for draft save ([schema.ts](/Users/cvr/Developer/personal/gyc/app/lib/content/pages/schema.ts:307)), and the FAQ editor renders only a `question` input plus read-only answer preview ([pages.$page.tsx](/Users/cvr/Developer/personal/gyc/app/routes/admin/pages.$page.tsx:338)). The service test fills `answer` by calling `editor.editDocument` directly ([cms-e2e.test.ts](/Users/cvr/Developer/personal/gyc/app/lib/content/cms-e2e.test.ts:535)), which is not a route/admin UI path. So the UI add→fill→publish loop is broken for FAQ.

2. `PageEditor` is not actually exhaustive at compile time. The comment claims “adding a Page without an editor is a type error,” but the switch has no `default`/`assertNever` and the function can silently return `undefined` for a newly added `PageId` ([pages.$page.tsx](/Users/cvr/Developer/personal/gyc/app/routes/admin/pages.$page.tsx:280)). This violates the prompt’s boundary-discipline requirement.

Non-blocking concerns:

- The dashboard page labels are a `Record<string, string>` instead of `{ [P in PageId]: string }` ([admin/_index.tsx](/Users/cvr/Developer/personal/gyc/app/routes/admin/_index.tsx:10)). It does iterate `PAGE_IDS`, so it is not a second page list, but the label map itself is not closed.
- There are several `as` casts in the view layer ([pages.$page.tsx](/Users/cvr/Developer/personal/gyc/app/routes/admin/pages.$page.tsx:123), [pages.$page.tsx](/Users/cvr/Developer/personal/gyc/app/routes/admin/pages.$page.tsx:289), [pages.$page.tsx](/Users/cvr/Developer/personal/gyc/app/routes/admin/pages.$page.tsx:558)). I read these as view-boundary shape reassertions after schema decode, not `any`-style type holes, but the exhaustive-switch gap makes that boundary less load-bearing than advertised.

Explicit checklist:

1. Slice fidelity: mostly 5.5, no obvious Branch 6 write path, but FAQ add UI is incomplete for the 5.5 admin loop.
2. Small interface/deep implementation: yes, writes route through `DraftEditor.editDocument`, `applyListOps`, and `publish` ([pages.$page.tsx](/Users/cvr/Developer/personal/gyc/app/routes/admin/pages.$page.tsx:129)); no new write path.
3. Subtract-before-add: yes, controls were hoisted and inline definitions deleted from `content.tsx`; diff shows `Text/Bilingual/ImageUpload/Section/ListOpButton/ItemControls/AddItemButton` removed and imported from `./controls`.
4. Impossible states/boundaries: page param decode is good ([pages.$page.tsx](/Users/cvr/Developer/personal/gyc/app/routes/admin/pages.$page.tsx:67)); registry-driven page set is good ([registry.ts](/Users/cvr/Developer/personal/gyc/app/lib/content/pages/registry.ts:68)); exhaustive editor is not upheld.
5. ADR 0006: draft schemas model id-only and malformed-present URL correctly ([schema.test.ts](/Users/cvr/Developer/personal/gyc/app/lib/content/pages/schema.test.ts:221)).
6. ADR 0008: publish busts only `bustTargetOf(scope)` ([draft-editor.server.ts](/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:631)) and content caches are per object ([content.server.ts](/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:572)).
7. Test surface: meaningful service/schema tests exist, but missing route/UI coverage for the FAQ add→fill→publish path.
8. Behavior regression: site editor migration looks behavior-preserving; the RichText read-only decision is okay generally, but not okay while still offering FAQ add.
9. Gate: not run in this read-only sandbox. No obvious unused import/non-exhaustive compile failure, but the non-exhaustive switch is a design/type-safety failure.
10. Principle violations: no `any`, stubs, or commented-out code found in the reviewed diff.
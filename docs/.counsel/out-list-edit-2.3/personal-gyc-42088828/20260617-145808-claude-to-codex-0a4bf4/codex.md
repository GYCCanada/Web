```ts
blocking = []
```

```ts
concerns = [
  {
    "area": "test coverage",
    "finding": "The new tests cover the service path and schema boundary, but not an actual route-action POST for `intent=list-op` (`collectListOps` → `applyListOps` → redirect). Given the route branch is thin, this is not blocking, but a targeted action test would pin the integration seam.",
    "receipts": [
      "/Users/cvr/Developer/personal/gyc/app/routes/admin/content.tsx:180",
      "/Users/cvr/Developer/personal/gyc/app/routes/admin/content.tsx:188",
      "/Users/cvr/Developer/personal/gyc/app/routes/admin/content.tsx:190",
      "/Users/cvr/Developer/personal/gyc/app/lib/content/cms-e2e.test.ts:211"
    ]
  }
]
```

```ts
verdict = "ship-with-follow-ups"
```

`applyListOps` is a justified deviation from the literal 2.3 wording. The plan’s intent is thin route plus DraftEditor-owned bucket/decode/store choreography; using `editDocument` before 2.4 would route remove/reorder through the still-present index-array `deepMerge`, which is exactly the wrong semantics. The new method is deep enough to belong in `DraftEditor`: load current draft, encode, apply id-keyed ops, draft-decode, store. Receipts: `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:81`, `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:98`, `/Users/cvr/Developer/personal/gyc/app/lib/content/admin-form.ts:221`, `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:364`.

`DraftSiteContent` is also justified. ADR 0006 requires add-to-draft with empty required fields while publish remains strict; CONTEXT says half-filled present content must never go live. One strict schema cannot express both. The implementation keeps identity/asset/enum leaves strict when present and relaxes only draft content leaves, then publish re-decodes strict `SiteContent` before writing live JSON. Receipts: `/Users/cvr/Developer/personal/gyc/docs/adr/0006-stable-list-item-ids.md:22`, `/Users/cvr/Developer/personal/gyc/docs/adr/0006-stable-list-item-ids.md:31`, `/Users/cvr/Developer/personal/gyc/CONTEXT.md:20`, `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:479`, `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:485`, `/Users/cvr/Developer/personal/gyc/app/lib/content/draft-editor.server.ts:401`.

The unique-id invariant is in scope for making id-keyed list editing safe. It is applied at both strict and draft boundaries, which is the right place to make duplicate identities impossible before remove/reorder can become ambiguous. Receipts: `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:155`, `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:335`, `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:537`.

No deletion obligation was missed for 2.3: the index merge, numeric setPath, and positional templates are explicitly 2.4 work. This commit correctly removes the `speakers.length > 0` gate by always rendering the Speakers fieldset with an Add button. Receipts: `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:83`, `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:99`, `/Users/cvr/Developer/personal/gyc/app/routes/admin/content.tsx:664`.

I did not rerun the gate in this read-only sandbox, but the claimed green gate is plausible from the inspected changes and the focused tests added for draft-lax/publish-strict, add/save/upload, and remove/reorder.
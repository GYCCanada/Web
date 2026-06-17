**Verdict: request-changes**

**BLOCKING**
1. `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:451`-`454` makes `hotels` a required `IdListArray(Hotel)`, but the existing read-path normalizer only backfills ids on existing `speakers`/`seminars` arrays and never supplies `hotels: []` for pre-3.1 stored conferences: `/Users/cvr/Developer/personal/gyc/app/lib/content/id-backfill.ts:64`-`73`. I confirmed an encoded pre-3.1-shaped document with the new optional URL fields and `hotels` omitted fails `SiteContent` decode. Since `content/site.json` is decoded through that path (`/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:336`-`340`), this would make an already-published bucket document malformed and fall back to bundled defaults (`/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:402`-`406`, `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:422`-`427`). That is a behavior regression/data-loss risk for live CMS content. Fix should be in this slice: boundary normalization/migration should add absent `hotels: []` per conference, with a regression test for pre-3.1 documents.

**CONCERNS**
None beyond the blocker.

The rest of 3.1 looks correctly scoped and solid: the commit only touches the advertised three files; 3.2/3.3/3.4 work is not leaked (`/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:138`-`142`). URL validation parses components and rejects protocol/credential/host/path spoof cases (`/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:139`-`198`), with the required test matrix present (`/Users/cvr/Developer/personal/gyc/app/lib/content/schema.test.ts:193`-`268`). Defaults supply 2024 detail data, 2025 `hotels: []`, and 2026 registration-only + `hotels: []` as planned (`/Users/cvr/Developer/personal/gyc/app/lib/content/defaults.ts:89`-`135`, `/Users/cvr/Developer/personal/gyc/app/lib/content/defaults.ts:304`-`308`, `/Users/cvr/Developer/personal/gyc/app/lib/content/defaults.ts:358`-`364`).

**References Used**
`/Users/cvr/Developer/personal/gyc/docs/.counsel/out-conference-detail-3.1/personal-gyc-42088828/20260617-155456-claude-to-codex-e6a542/prompt.md`  
`/Users/cvr/Developer/personal/gyc/docs/.counsel/conference-detail-3.1.diff`  
`/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`  
`/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md`  
`/Users/cvr/Developer/personal/gyc/CONTEXT.md`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/schema.test.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/defaults.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/id-backfill.ts`  
`/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2024/_index.tsx`  
`/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2025/_index.tsx`  
`/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2026/_index.tsx`
# CMS Patterns Polish — Plan

**Branch:** `cms/patterns-polish` (stacked on `cms/storage-foundation` PR #11 → `revival/2026-speak` PR #10).
**Status:** in progress (ultracode workflow `.claude/workflows/gyc-cms-polish.js`).

This document is handed to Codex on **every** `okra counsel` review so it situates each
sub-commit against the whole effort. Keep it current.

---

## Why

A multi-agent review of the CMS code (PR #11) against `anomalyco/opencode`
(`/Users/cvr/.cache/repo/anomalyco/opencode` — a mature Effect v4 codebase: 173
`Context.Service`, 0 `Tag`, 0 `Effect.Service`) found our patterns **strong and broadly
idiomatic** — matching or beating opencode on deterministic service keys, JSON-codec
discipline, the empty-string config defense, the semantically-faithful `Storage.layerOptional`,
and the RR7 `throwCauseError` bridge. This branch closes the **real, justified** gaps the
review surfaced. It is pure internal-quality work: **no user-facing behavior change** (except
the cache's documented ≤TTL staleness window — see C1), gate-green per commit, Codex-counseled.

Findings NOT adopted (conscious keeps, do NOT flag): deterministic full-path service keys
(more collision-safe than opencode's short handles); `registration: OptionFromOptionalKey`
(against opencode's `Schema.optional` grain but justified by make-impossible-states-
unrepresentable); `HttpRouter` over `HttpApi` (no public API contract); the `throwCauseError`
RR7 error bridge (correct for thrown-`Response` control flow).

## End goal

The CMS services read as if written by the opencode team: built-in cache primitive instead
of a hand-rolled one, branded validated primitives, every service method a traced
`Effect.fn("Service.method")`, structured (not string-matched) infra errors with preserved
causes, platform streaming for static files, and module-level `layer`/`defaultLayer` per
service.

---

## Sub-commit sequence (one wave; each compiles + passes gate + Codex-counseled)

Ordered subtract-before-you-add (the cache deletion first) → safe schema/error hardening →
mechanical sweeps → convention churn last.

### C1 — Replace hand-rolled cache with `Effect.cachedInvalidateWithTTL`; drop the epoch
**`use-the-platform`, `subtract-before-you-add`.** Verified: `Effect.cachedInvalidateWithTTL`
exists (`effect-smol packages/effect/src/Effect.ts:7118`, sig
`(self, ttl) => Effect<[Effect<A,E,R>, Effect<void>]>`); opencode uses it for the same
cached-document-with-bust use case (`packages/opencode/src/config/config.ts:281`,
`packages/core/src/models-dev.ts:215`).
In `app/lib/content.server.ts` `Content.layer`: delete the `Ref` cache (`:344`), the
single-permit `Semaphore` (`:345`), the monotonic publish-`epoch` `Ref` (`:359`) and all the
epoch dance in `getSiteContent` (`:415-460`) + `bust` (`:561-567`), plus the `Semaphore`
import (`:9`) and `CacheEntry`/`CACHE_TTL_MS` plumbing as appropriate. Replace with:
```ts
const [cachedContent, invalidate] =
  yield* Effect.cachedInvalidateWithTTL(fetchDocument, Duration.millis(CACHE_TTL_MS));
const getSiteContent = () => cachedContent;
const bust = () => invalidate;
```
**Decision (user-approved):** drop the epoch. The built-in does NOT close the
bust-during-in-flight-refresh race the epoch guarded; for a 30s-TTL low-write CMS the worst
case is a publish landing exactly during an in-flight refresh being invisible for ≤1 more
TTL (≤30s) — within D3's "visible on the next read" contract. **Update the `Content` doc
comment** to state this explicitly (the staleness window is now a documented property, not a
bug). Keep `fetchDocument` (decode + fallback) and all derived selectors unchanged.
VERIFY: `content.server.test.ts` green (adapt the TTL/single-flight tests to the new shape —
they previously asserted reference-equality within TTL; keep that contract). Boot dev, confirm
`/`, `/2026` still render from defaults. Net ~-65 lines.

### C2 — Brand the validated primitives
**`make-impossible-states-unrepresentable`, `boundary-discipline`.** opencode brands every
validated newtype (`packages/core/src/system-context/index.ts:22` `SystemContext.Key`,
`packages/core/src/schema.ts:25-31` `AbsolutePath`/`RelativePath`). In
`app/lib/content/schema.ts`, append `.pipe(Schema.brand("..."))` to `AssetKey` (`:79`),
`IsoDate` (`:149`), `HexColour` (`:111`), and the conference `slug` (`:253`). Propagate the
branded types through the boundary signatures that currently take plain `string` —
`toEndOfDayMs(date: IsoDate)` / `assetUrl(key)` etc. in `content.server.ts` — so the
validation guarantee is load-bearing past the decoder. Round-trip tests in
`content/schema.test.ts` should still pass (branding is encode/decode-transparent); add an
assertion that a raw string is NOT assignable where a brand is required (type-level, or a
decode-rejects test for a bad value).

### C3 — Structured infra errors: stop string-matching; preserve causes
**`boundary-discipline`, `correctness-over-pragmatism`.** (a) `Storage.get` not-found
detection currently does `String(e).includes('NoSuchKey' | 'does not exist' | '404')`
(`storage.server.ts:236-242`) — brittle. Match the structured Bun error instead
(`e instanceof Bun.S3Error && e.code === 'NoSuchKey'`, plus `.stat()`/`.exists()` where
appropriate), mirroring opencode's structured `missing()` predicate
(`packages/opencode/src/storage/storage.ts:67-74`, `packages/core/src/fs-util.ts:114`). (b)
Add a `cause: Schema.optional(Schema.Defect)` field to `StorageError` / `MailError` /
`MailchimpError` and stop flattening to `message: String(e)` at the failure site
(`storage.server.ts:243,257`; `mailer.server.ts:59`; `mailchimp.server.ts:67`), following
opencode `packages/core/src/fs-util.ts:14-17`, `packages/core/src/auth.ts:54-57`. Keep the
useful `key`/`op` discriminants on `StorageError`. VERIFY: storage tests green; the
disabled-storage `layerOptional` still yields `NotFound`/`StorageError` correctly.

### C4 — `Effect.fn("Service.method")` tracing sweep
**Observability convention (opencode: 1029 `Effect.fn` uses; every service method is a named
span — `packages/core/src/git.ts:80` `Effect.fn("Git.find")`).** Wrap every service method in
`Storage`, `Content`, `Auth`, `Mailer`, `Mailchimp` as
`Effect.fn("Storage.get")(function* (...) {...})` etc., replacing the bare
`Effect.gen`-in-`.of({...})` arrows. Use `Effect.fnUntraced` for genuinely-internal helpers
(opencode reserves it for hot/internal — `git.ts` split). Rename the lone existing
`Effect.fn('listStoredObjects')` (`storage.server.ts:96`) — it's an internal helper, so
either `Effect.fnUntraced` or a non-method label. Pure mechanical; no behavior change. Gate
green (watch the effect LSP `effectFnOpportunity`/`effectFnImplicitAny` diagnostics).

### C5 — Module-level `layer`/`defaultLayer`; error-tag rename; relocate test layer
**opencode's strongest service convention (137 `export const layer` vs 4 static).** (a)
Convert `Storage.layer`/`Content.layer`/`Env.layer`/`Auth.layer` (+ `layerOptional`,
`layerTest`) from `static` members to module-level `export const layer` / `export const
layerOptional`, and add a per-service `export const defaultLayer` that pre-provides deps
(`Content`: `defaultLayer = layer.pipe(Layer.provide(Storage.layerOptional))`, mirroring
`git.ts:347`). Then `effect/runtime.ts` lists `Content.defaultLayer` and drops the inline
`Content.layer.pipe(Layer.provide(StorageLive))` hand-wiring (keep `Storage` provided
standalone for the admin write path — a legit second consumer). (b) Shorten error-tag keys
from path-style `"gycc/lib/storage.server/StorageError"` to domain-namespaced
`"Storage.Error"`-style (move-stable; opencode `"Session.MessageDecodeError"`
`packages/core/src/session/error.ts:5`) — update every `catchTag`/`catchTags` string
(`server.ts`, `routes/admin/content.tsx`, `content.server.ts`). (c) Relocate `Storage.layerTest`
+ its in-memory Map impl out of the production file into a test-local helper (opencode keeps
test layers under `test/`, per its AGENTS.md "test real impl"), updating
`content.server.test.ts` + `storage.server.test.ts`. This is the churniest commit — do it last
so a rename mistake can't block the substantive work above. Gate green incl. all `catchTag`
strings resolving.

## Verification (prove-it-works)

Gate per commit: `cd /Users/cvr/Developer/personal/gyc && bun run typecheck && bun run lint &&
bun run build && bun test`. Runtime: C1 — boot dev, `/` + `/2026` render from defaults, and
the publish→bust→read path (via in-memory layer test) still reflects a change. C3 — confirm
not-found still falls back to defaults / `public/` files. No user-facing behavior change
elsewhere; the test suite (103 tests) is the regression guard — keep it green throughout.

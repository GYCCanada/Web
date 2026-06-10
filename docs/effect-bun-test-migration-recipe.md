# effect-bun-test migration recipe

Migrate test files from raw `bun:test` + hand-rolled `run`/`runExit` helpers to
`effect-bun-test`'s `it.effect`. The pattern is already proven on
`app/lib/auth.server.test.ts` (read it as the worked example).

## Import rename

```diff
- import { describe, expect, it } from 'bun:test';
+ import { describe, expect, it } from 'effect-bun-test';
```

`describe`, `expect`, `it` are all re-exported by `effect-bun-test`. Keep all
other imports (`Effect`, `Layer`, `Schema`, `TestClock`, service modules, …)
exactly as they are.

## What `it.effect` gives you for free — DO NOT re-provide these

`it.effect('name', () => <Effect>)` runs the returned Effect with, automatically:

- **`Effect.scoped`** — a `Scope` is already provided. Remove any `Effect.scoped`
  wrapper from the helper.
- **`TestClock`** — a `TestClock` layer is already provided. **Remove any
  `TestClock.layer()` from the per-test provide.** (Double-providing it is a
  type/wiring error.) `TestClock.adjust(...)` / `TestClock.setTime(...)` calls
  inside the test body stay — they drive the auto-provided clock.
- **`Effect.runPromise`** — the run is done for you. The test body is an Effect,
  not a Promise; never call `Effect.runPromise` on the top-level test effect.

So a hand-rolled helper like:

```ts
const run = (effect, layer) =>
  Effect.runPromise(Effect.scoped(Effect.provide(effect, [layer, TestClock.layer()])));
```

collapses to a pure provide:

```ts
const provide = (layer) => (effect) => effect.pipe(Effect.provide(layer));
```

## Transformation rules

### Rule 1 — `run(effect, layer)` → `it.effect(..., () => effect.pipe(provide(layer)))`

The success-path helper just provides a layer. Replace the call form:

```ts
// BEFORE
it('does X', async () => {
  const value = await run(
    Effect.gen(function* () {
      const svc = yield* Service.Service;
      return yield* svc.doThing();
    }),
    someLayer,
  );
  expect(value).toBe(...);
});

// AFTER — the effect IS the test; assertions move INSIDE the gen
it.effect('does X', () =>
  Effect.gen(function* () {
    const svc = yield* Service.Service;
    const value = yield* svc.doThing();
    expect(value).toBe(...);
  }).pipe(provide(someLayer)));
```

Move every `expect(...)` that ran on the awaited result INTO the generator,
after the `yield*` that produced the value. The test body must end as an
`Effect<void, …>` (no trailing non-Effect return).

### Rule 2 — `runExit` + failure inspection → in-Effect `Effect.flip`

When the helper was `runExit` and the test asserted a tagged failure, prefer
`Effect.flip` (turns `Effect<A, E>` into `Effect<E, A>` — the error becomes the
success), then `instanceof`:

```ts
// BEFORE
const exit = await runExit(effect, layer);
expect(Exit.isFailure(exit)).toBe(true);
if (Exit.isFailure(exit)) {
  const failed = exit.cause.reasons.some(
    (r) => r._tag === 'Fail' && Schema.is(SomeError)(r.error),
  );
  expect(failed).toBe(true);
}

// AFTER
it.effect('fails with SomeError', () =>
  Effect.gen(function* () {
    const svc = yield* Service.Service;
    const error = yield* Effect.flip(svc.doFailingThing());
    expect(error).toBeInstanceOf(SomeError);
  }).pipe(provide(layer)));
```

`Effect.flip` only catches *failures* (the `E` channel). A defect would escape
and fail the test as an unhandled error — which is the correct behavior (a defect
IS a test failure). Use `toBeInstanceOf(SomeError)` for the tag check.

### Rule 3 — keep `Effect.exit` only when you must inspect the Exit shape

If a test genuinely needs the `Exit` (e.g. asserts `Exit.isSuccess` on a layer
construction, or checks both success-or-failure without caring which error),
keep `Effect.exit` inside the gen:

```ts
it.effect('constructs when configured', () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(SomeLayer-building-effect);
    expect(Exit.isSuccess(exit)).toBe(true);
  }));
```

Do NOT pull `Exit` out to the Promise level — there is no Promise level anymore.

### Rule 4 — varying layers per test: a per-file `provide` helper, NOT `it.effect.layer`

These files build a DIFFERENT layer per test (different env maps, different
in-memory storage seeds). So do NOT use `it.effect.layer(...)` at the describe
level. Instead keep a tiny module-level helper and pipe each test through it:

```ts
const provideEnv = (env: Record<string, string>) =>
  Effect.provide(Layer.provide(Env.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env }))));

it.effect('…', () => Effect.gen(function* () { … }).pipe(provideEnv(PROD_ENV)));
```

(When a whole `describe` shares ONE fixed layer — like auth's enabled/disabled
blocks — `const test = it.effect.layer(theLayer)` at the top of the describe is
cleaner. Use your judgment: fixed-per-describe → `it.effect.layer`; varies
per-test → per-file provide helper.)

### Rule 5 — pure-sync tests use `test`, NOT `it` (`it` is not callable)

GOTCHA: in `effect-bun-test@0.3.0`, `it` is an **object** (`it.effect`,
`it.scoped`, `it.live`, `it.scopedLive`), not a callable. The plain bun test
function is re-exported as **`test`**. So a pure-sync test (only sync `expect` on
a plain function, e.g. `imageKeyFromPath`, `Schema.decodeUnknownResult(...)._tag`)
must call `test(...)`, not `it(...)` — `it(...)` throws `it is not a function` at
runtime.

```diff
- import { describe, expect, it } from 'bun:test';
+ import { describe, expect, it, test } from 'effect-bun-test';   // mixed file
  // …
- it('refuses traversal', () => { expect(imageKeyFromPath('…')).toBeNull(); });
+ test('refuses traversal', () => { expect(imageKeyFromPath('…')).toBeNull(); });
```

For a file with NO Effect tests at all, alias on import:
`import { describe, expect, test as it } from 'effect-bun-test';` and leave the
bodies as `it(...)`. For a mixed file, import both `it` and `test` and route
sync tests through `test`, Effect tests through `it.effect`.

Tests that call `Effect.runPromise(...)` INLINE (not via a helper) for a one-off
encode/decode can either:
- stay `async it` with the inline `Effect.runPromise` (works — `it` is
  re-exported), OR
- convert to `it.effect` by moving the effect to the body and dropping
  `runPromise`. Prefer `it.effect` when the whole test is one Effect; keep
  `async it` when it's mostly sync with a single inline encode.

## Validation (run between files)

```sh
cd /Users/cvr/Developer/personal/gyc && bun test <the-file-you-just-changed>
```

Then at the end, the full gate:

```sh
cd /Users/cvr/Developer/personal/gyc && bun run typecheck && bun run lint && bun test
```

STOP and report if a file does not fit these rules (e.g. a test that needs the
real wall clock, not `TestClock` — those want `it.live` instead of `it.effect`,
which none of the surveyed files appear to need).

## Three gotchas (learned the hard way)

1. **`it` is not callable** — see Rule 5. Sync tests use `test`.

2. **A per-test layer can only reference values defined OUTSIDE the gen.** The
   `.pipe(provide(layer))` runs at describe-evaluation time, not inside the test
   effect, so a `const` declared inside `Effect.gen(function* () { … })` is NOT
   visible to the `provide(...)` argument. If the seed layer needs a derived doc,
   build that doc as a plain (pure) `const` in the test's arrow body BEFORE the
   `return Effect.gen(...)`, e.g.:
   ```ts
   it.effect('…', () => {
     const edited = { ...defaultContent, /* pure transform */ };  // OUTSIDE the gen
     return Effect.gen(function* () { … }).pipe(provideSeeded(edited));
   });
   ```

3. **A layer built from an `Effect` that can fail (`SchemaError` from `encode`)
   has a non-`never` error channel** and won't satisfy a `Layer<S>` /
   `Layer.provideMerge` slot. Build it with `Layer.unwrap(eff.pipe(Effect.orDie,
   Effect.map(factory)))` — `orDie` promotes the encode failure to a defect (a
   seed doc that won't encode is a test bug, not a tested failure path), keeping
   the layer's error channel `never`. See `seededStorage` in
   `content.server.test.ts`.

4. **Moving raw JS into a gen trips effect-language-service diagnostics.**
   `JSON.parse`/`JSON.stringify` → `preferSchemaOverJson`; `new Date(...)` →
   `globalDateInEffect`. Keep such raw-JS sanity helpers at module scope (outside
   any `Effect.gen`), exactly where they lived pre-migration.

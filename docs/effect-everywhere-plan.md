# Effect Everywhere — zod → Effect Schema + Effect-runtime loaders/actions

Status: planned 2026-06-10; Codex plan review (deep) applied — 5 blockers folded
into C1–C5 (marked ⚠ Codex). Branch `effect/everywhere` off `main` (post PR #10 merge).
Executed as an ultracode workflow: Opus implements per commit, Codex (`okra counsel`)
reviews per commit, orchestrator verifies between commits and reviews the final diff.

## Goal

Finish what the 2026 revival started (ADR 0004 removed zod from env config): make
Effect the only validation/runtime layer in the app.

1. **Replace zod with Effect Schema** everywhere (7 files import zod today).
2. **Run every loader/action through the Effect runtime** (`routeHandler` /
   `routeAction`) — today only 3 of 11 route modules do.
3. **Port the bureau-grade RR7+Effect integration**: tagged HTTP errors,
   Effect-native redirect, conform `/future` + `SubmissionContext` form pipeline,
   Effect Schema form validation.

## Reference corpus (read before implementing)

| What | Where |
|------|-------|
| Bureau RR7+Effect integration (the standard to port) | `/Users/cvr/Developer/work/bite/packages/bureau/app/lib/effect/` — `route.server.ts`, `runtime.server.ts`, `errors.server.ts`, `form-submission-context.server.ts`, `form-schema.server.ts`, `router-context.server.ts`; `app/lib/conform.ts`; example routes `app/routes/login/route.tsx`, `app/routes/_dashboard/tools/whitelisting/route.tsx` |
| Effect v4 patterns | skill `~/.claude/skills/effect-v4/SKILL.md` (+ `references/schema.md`, `references/services.md`) |
| Effect v4 source (beta.60 pinned here) | `/Users/cvr/.cache/repo/effect-ts/effect-smol` — `packages/effect/SCHEMA.md`, `packages/effect/src/Schema.ts` |
| Pattern standard | `/Users/cvr/.cache/repo/anomalyco/opencode` — Context.Service shape, error taxonomy, deterministic keys |
| Existing gyc Effect layer | `app/lib/effect/{runtime,route,router-context}.ts`, `app/lib/env.server.ts`, `app/lib/{mailer,mailchimp}.server.ts` |

Key version facts (verified): `effect@4.0.0-beta.60` already exports
`Schema.toStandardSchemaV1`. Installed `@conform-to/react` is **1.19.4** (range
`^1.1.5` resolved forward) → the `/future` export is available without an upgrade.
Installed `zod` is 3.25.76 (Standard Schema capable); `@conform-to/zod@1.19.4`
ships `/v3/future` with `coerceFormValue` for the interim state in C4.

## Current state (grounded inventory)

**zod imports (7):** `app/lib/toast.server.ts`, `app/routes/($lang)+/contact.tsx`,
`volunteer.tsx`, `_index.tsx`, `2024/form/route.tsx`, `2025/form/route.tsx`,
`2026/form/route.tsx`.

**Loaders/actions NOT on the Effect runtime:** `app/root.tsx` (loader, async,
getToast), `($lang)+/_layout.tsx`, `($lang)+/{2024,2025,2026}/_index.tsx`,
`($lang)+/team/_index.tsx`, `($lang)+/_index.tsx` (loader only; action already
migrated), the 3 form routes (plain loader + **no-op** `action = async () => {}`).

**Form stack:** conform **classic v1 API**. UI primitives `app/ui/text-field.tsx`,
`radio.tsx`, `checkbox.tsx`, `select.tsx` bind via classic `useField` (tuple) +
`useInputControl` + classic `FormProvider` (wrapped context), stashing `meta`/
`control` in a local `TextFieldContext` consumed by `input.tsx`, `text-area.tsx`,
`label.tsx`, `field-error.tsx`. The classic and `/future` systems are **not
interoperable** (different `useForm`/`useField` return shapes, no `useInputControl`
in future, incompatible `FormProvider` context types) → the primitive flip and all
form-route flips must be coordinated (see C4).

**Error messages are translation keys** (e.g. `'volunteer.form.name.required'`)
carried as zod `required_error`/`invalid_type_error` strings; `FieldErrors` renders
`translate(error as TranslationKey)`. This contract must survive: Effect Schema
check messages carry the same keys (`Schema.isMinLength(1, { message: 'volunteer.form.name.required' })`).

**Registration form routes are byte-identical** (688 lines each) except line 199's
year literal. Their actions are deliberate no-ops (product decision pending).

**Existing runtime gap vs bureau:** gyc's `throwCauseError` only understands raw
`Response` failures/defects; no tagged HTTP errors, no Effect-native redirect, no
form pipeline. Toast helpers are plain async + zod.

## Final-state invariants (greppable; verified in C7)

- `grep -rn "from 'zod'\|from \"zod\"\|@conform-to/zod" app server.ts` → **zero** hits; deps removed from package.json.
- `grep -rn "parseWithZod\|useInputControl\|from '@conform-to/react'" app` → zero (all conform via `~/lib/conform` re-exports of `/future`).
- Every route `loader`/`action` export goes through `routeHandler`/`routeAction`/`routeFormAction`. No `LoaderFunctionArgs`-typed plain handlers remain in `app/routes/` or `app/root.tsx`.
- All HTTP-shaped failures are tagged errors (`Schema.TaggedErrorClass`) mapped centrally in `runtime.ts`; no `throw new Response` / `throw redirect()` inside route effects.
- Side-effectful server libs are `Context.Service` with deterministic keys; toast is a service; schemas are Effect Schema codecs.
- Gate green: `bun run typecheck && bun run lint && bun test && bun run build`.

## Non-goals / accepted drift

- **Registration actions stay no-op** — do not invent submission handling.
- `getCurrentConference` (pure TS data lookup) stays a pure function — services are
  for side effects; also avoids colliding with the CMS PR #11 `Content` service.
- Registration schema currently uses **zod default English messages** (not
  translation keys). After C5 these become Effect Schema default/keyed messages —
  minor copy drift on a client-only validation path is accepted; where cheap, add
  proper translation keys consistent with sibling forms.
- Toast cookie secret stays hardcoded `'secret-key'` (pre-existing); deferred:
  move to `Config.redacted` with dev default.
- `dayjs`, `ts-pattern`, UI components beyond the conform bindings: untouched.
- PR #11 (CMS, stacked) touches `runtime.ts`/`server.ts` — conflicts are expected
  and resolved at that PR's rebase, not here. Note it in the PR body.
- **Invalid-type keys without a translation reuse `.required`.** The old zod
  contact/volunteer schemas pointed several `invalid_type_error`s at `.error`
  keys that never existed in `translations.ts`
  (`volunteer.form.{name,age,location,background,why}.error`,
  `contact.form.{message,phone}.error`, `volunteer.form.phone.error`). Those
  rendered blank in the old UI (`FieldErrors` calls `translate()` on the raw
  message). The Schema migration restores the discriminator/invalid-type hooks
  via `message` + `messageMissingKey` annotations, but points the messages with
  no dedicated `.error` key at the field's existing `.required` key instead of
  re-introducing the dead keys — every emitted validation message is now a real
  `TranslationKey` (guarded by the route-schema tests). Fields that DO have a
  real `.error` key (`name`/`email` on contact, `email` on volunteer) keep it.

## Commit breakdown

Each commit: implement → gate → `okra counsel` (Codex, diff review with this plan
in context) → apply **blocking** feedback → re-gate → commit. Conventional Commits.

### C1 — `feat(effect): tagged HTTP error taxonomy + runtime error mapping`

New `app/lib/effect/errors.ts` (bureau `errors.server.ts`, scaled down):

- `Schema.TaggedErrorClass` errors with short domain-namespaced tags (CMS-polish
  convention, e.g. `'Http.Redirect'`): `RedirectError { url, init? }`,
  `NotFoundError`, `BadRequestError { message? }`, `InternalServerError`,
  `FormValidationError { error: { formErrors?, fieldErrors? } }`. `static is = Schema.is(this)`.
- Yieldable helpers: `redirect(url, init?)`, `notFound()`, `formValidationError(err)`.

`app/lib/effect/runtime.ts`:

- `throwCauseError`/`throwHttpError` gain tagged-error mapping **before** the raw
  `Response` passthrough: `RedirectError` → RR `redirect(url, init)` (init carries
  headers, e.g. set-cookie), `NotFoundError` → 404 `data`, `BadRequestError` → 400,
  `InternalServerError` → 500. Keep raw `Response` passthrough (transition + root
  ErrorBoundary). Update `AppError` union.
- Unit tests for the mapping (use main's existing test harness — note:
  `effect-bun-test` lives on the CMS branch, NOT main; do not import it. Check
  `app/lib/services.test.ts` for the local idiom).
- ⚠ Codex: verify `RouteArgs`/`ReactRouterContext` typing actually carries the
  normalized `url: URL` arg (RR8 `v8_passThroughRequests` is ON and root/contact/
  volunteer/newsletter all destructure `url` from the context — typecheck passes
  today, but `router-context.ts:4` types it as plain `LoaderFunctionArgs`). If the
  RR types don't guarantee `url`, fix `RouteArgs` here (before C2/C6 migrate the
  consumers) — e.g. intersect with `{ url: URL }` or use RR's flag-aware arg types.

### C2 — `refactor(toast): Toast as an Effect service on Effect Schema`

- `app/lib/toast.server.ts`: zod `ToastSchema` → Effect Schema. ⚠ Codex: zod's
  `.default()` applies during **parse** — the Effect equivalent is
  `Schema.withDecodingDefault`/`withDecodingDefaultKey` (decode-time), NOT
  `withConstructorDefault` (`.make`-time only). Apply decode defaults for `id`
  (`Effect.sync(() => nanoid())`) and `type` (`'message'`); add constructor
  defaults too if `.make` is used. Test stale/partial session payloads decode with
  defaults applied. `Toast`/`ToastInput` types derived from the schema.
- New `Toast` `Context.Service` (key `gycc/lib/toast/Toast`): `get` (reads+clears
  flash cookie, returns `{ toast: Option<Toast> | null-compatible shape, headers }`
  preserving today's contract), `redirect(url, toast, init?)` → fails with
  `RedirectError` whose init merges the toast set-cookie headers. `Effect.fn` on
  methods. Layer added to `AppLayer` in `runtime.ts`; `AppServices` updated.
- Call sites: `contact.tsx`, `volunteer.tsx`, `_index.tsx` replace
  `yield* Effect.promise(() => redirectWithToast(...))` with `yield* toast.redirect(...)`.
- `app/root.tsx` loader → `routeHandler` (first consumer through the runtime):
  `getHints(request)` + toast via service, return `data(payload, { headers })`
  **identically shaped** to today (theme hints + toast flash must not regress).
- Tests: toast schema decode (id default, bad payload → null path preserved).

### C3 — `feat(effect): form pipeline — SubmissionContext, Schema validation, conform facade`

Infra only — no route flips; classic routes keep compiling/working.

- `app/lib/effect/form.ts`: `SubmissionContext` (`Context.Service` holding conform
  `/future` `Submission`); `FormSuccess = { reset: boolean }`; `routeFormAction`
  wrapper modeled on bureau `runtime.server.ts form()` (simplified — no intent
  dispatch): parse `request.formData()` → `parseSubmission` (failure →
  `BadRequestError`) → provide `SubmissionContext` → run the generator → success
  returns `{ result: report(submission, { reset }), status: 'success' }`;
  `FormValidationError` → `{ result: report(submission, { error }), status: 'error' }`;
  other tagged errors → form-level error report; redirects propagate via C1 mapping.
- `app/lib/effect/form-schema.ts`: port bureau `form-schema.server.ts` —
  `parseSchema(schema, payload)` (`Schema.decodeUnknownResult`) +
  `formatSchemaResult` (`SchemaIssue.makeFormatterStandardSchemaV1`, bucket into
  `{ formErrors, fieldErrors }`). ⚠ Codex: field-error keys must be **conform
  field names**, not dotted paths — array members are named `registrants[0].email`,
  so a `registrants.0.email` key never attaches. Use `formatPath` from
  `@conform-to/dom/future` (see bureau `app/lib/conform.ts:21`) to serialize issue
  paths; unit-test a nested-array path explicitly.
- `routeFormAction` is a **new, separate wrapper** alongside the existing generic
  `routeAction` (which today is just `routeHandler` for actions) — document both
  contracts: `routeAction` for non-form effects, `routeFormAction` for conform
  forms returning `FormResult`.
- `app/lib/conform.ts`: port bureau `conform.ts` — `configureForms({ isSchema, validateSchema })`
  wired for StandardSchemaV1, re-export `useForm`, `FormProvider`, `useField`,
  `useControl`, `parseSubmission`, `report` from `@conform-to/react/future`.
- Tests: `formatSchemaResult` bucketing (form-level vs field path), `routeFormAction`
  success/validation-error/redirect flows.

### C4 — `refactor(forms): conform classic → /future (primitives + all form routes)`

The atomic flip — classic and future cannot coexist on shared primitives.

- `app/ui/{text-field,radio,checkbox,select}.tsx`: rebind internals to `/future`
  `useField` (single object) + `useControl` (no `useInputControl` in future),
  **preserving the external component API and the local `TextFieldContext`** so
  consumer JSX is minimally touched. `input.tsx`/`text-area.tsx`/`label.tsx`/
  `field-error.tsx` adjust to the future field-metadata shape (`errors`,
  `required`, `ariaInvalid`…). `FieldErrors` keeps `translate(error as TranslationKey)`.
  ⚠ Codex: future `useControl` is NOT a drop-in for `useInputControl` — it exposes
  a `register` ref callback that must be attached to a real input (or render a
  `BaseControl`/hidden input) for the Base UI radio/checkbox/select wrappers,
  otherwise form data and validation silently break (`future/hooks.d.ts:114`,
  `future/types.d.ts:42`). Each migrated primitive gets a dev-server smoke
  (value present in submitted FormData + error renders).
- ⚠ Codex API notes: future `useForm` returns `{ form, fields, intent }` (no
  tuple); there is no `getFormProps`/`getFieldsetProps`/`getCollectionProps`/
  `FormStateInput` in `/future` — use `form.props`, field metadata, and
  `intent.insert(...)` for the dynamic registrants array.
- Live forms go **fully final** in this commit (small schemas, real actions):
  - `contact.tsx`, `volunteer.tsx`, `_index.tsx` (newsletter): zod schemas →
    Effect Schema codecs with translation-key messages preserved **field-for-field**.
    ⚠ Codex: the newsletter schema today uses zod **default** messages (not keys) —
    add proper keys (`main.newsletter.email.error`, `main.newsletter.name.required`)
    to BOTH locales in `app/lib/localization/` rather than shipping raw English
    through `translate()`; counsel verifies key existence in en+fr.
    (discriminated unions via `Schema.Union` of tagged structs; messages via check
    `{ message }` — bureau `login.utils.ts` idiom); client `useForm(toStandardSchemaV1(schema), { lastResult: actionData?.result, ... })`
    via `~/lib/conform`; server actions → `routeFormAction` + `SubmissionContext` +
    `parseSchema`/`formatSchemaResult`; mailer/mailchimp dispatch and toast redirect
    behavior unchanged (form-level error keys `'contact.form.error'` /
    `'main.newsletter.error'` exactly as today). Replace `FormStateInput`/
    `getCollectionProps`/`getFormProps` classic helpers with future equivalents.
  - Registration routes ×3: **client-side flip only** — future `useForm` with the
    existing zod schema through `coerceFormValue` from `@conform-to/zod/v3/future`
    (zod 3.25 implements Standard Schema; verify `~standard` on the v3 entry at
    implement time — if it's v4-only, fallback is converting the registration
    schema to Effect Schema in this commit instead of C5). Dynamic registrant
    array (`form.insert`) → future intent API. Actions remain no-op.
- Manual smoke per form (dev server): submit invalid → field errors translated;
  submit valid (contact/volunteer/newsletter) → toast redirect.

### C5 — `refactor(registration): dedupe 3×688-line routes + zod → Effect Schema`

- Extract the shared form into one component parameterized by year (e.g.
  `app/routes/($lang)+/registration-form.tsx` or co-located shared module — pick
  what `routes.ts` keeps cleanest); the 3 route files become thin wrappers
  (meta + loader + action + `<RegistrationForm year={…} />`). Removes ~1,370
  duplicated lines.
- `RegistrationSchema` → Effect Schema **codec from form-data shapes**: strings
  stay strings; booleans decode from form values (study how bureau models
  checkbox/boolean fields with Standard Schema — e.g. whitelisting route — and
  what `parseSubmission` yields for checkboxes; ⚠ Codex: there is no
  `Schema.BooleanFromString` in beta.60 — write a custom string/literal→boolean
  codec or literal unions accordingly); nested `parent` optional struct; literal
  unions for `gender`/`outreach`/`merch`. Client validation through
  `toStandardSchemaV1`; drop `coerceFormValue` interim.
- Loaders → `routeHandler` (locale via `ReactRouterContext` params +
  `getCurrentConference`); actions → `routeAction` no-op (typed, still no-op).
- The per-route `meta`/heading year handling stays ({ year } param already passed — keep).

### C6 — `refactor(routes): remaining loaders onto the Effect runtime`

- `($lang)+/_layout.tsx`, `($lang)+/{2024,2025,2026}/_index.tsx`,
  `($lang)+/team/_index.tsx`, `($lang)+/_index.tsx` loader: plain handlers →
  `routeHandler` with `ReactRouterContext` (sync data lookups stay pure inside).
  Return shapes byte-identical (loader data is consumed by typed `useLoaderData`).

### C7 — `chore: drop zod + @conform-to/zod, document the architecture`

- Remove `zod`, `@conform-to/zod` from package.json; pin `@conform-to/react`
  range honestly (`^1.19.4`); `bun install`; lockfile updated.
- Run the **final-state invariant greps** (above) and paste results in the commit body.
- ADR 0005 `docs/adr/0005-effect-everywhere.md`: Effect Schema as the only
  validation layer; Effect runtime as the only loader/action path; conform
  `/future` + StandardSchema; tagged HTTP error taxonomy; what was deferred
  (cookie secret → Config, registration action, CMS overlap). Update `CONTEXT.md`
  stack section.
- Full gate + route smoke (all routes 200 EN+FR — `bun run dev`, curl sweep).

## Gate

`bun run typecheck && bun run lint && bun test && bun run build` — between every
commit, not just at the end. Dev-server smoke for form flows in C4/C5.

## Counsel protocol (per commit)

After staging (pre-commit): `okra counsel "Review the staged diff for commit <Cn>
of docs/effect-everywhere-plan.md (read the plan first). Ground claims in file
paths. Flag: behavior regressions vs the plan's invariants, translation-key
message drift, conform future-API misuse, Effect v4 anti-patterns
(per ~/.claude/skills/effect-v4/SKILL.md core rules). Distinguish BLOCKING vs
nit."` → read `/tmp/counsel/<bucket>/<ts>-claude-to-codex-<hash>/codex.md` →
apply blocking feedback → re-gate → commit. Record codex verdict in the commit body
(`Codex-review: <summary>`).

## Risks

1. **C4 atomicity** — primitives + 6 routes in one commit. Mitigation: live-form
   schemas are small; registration flip is mechanical; verifier agent re-runs gate
   + smoke before C5 starts.
2. **Coercion drift** — classic `parseWithZod` auto-coerced (`''`→undefined,
   checkbox `'on'`→boolean). Future + StandardSchema does not. Mitigation:
   `coerceFormValue` interim for registration; Effect Schemas written as
   form-data codecs; smoke tests submit real forms.
3. **Translation-key contract** — every zod `required_error`/`invalid_type_error`
   key must reappear verbatim in Schema check messages. Counsel explicitly diffs
   the key sets per form.
4. **Toast flash round-trip** — session decode shape changes (zod safeParse → Schema
   decode). Preserve the `null`-on-invalid contract so stale cookies don't 500.
5. **zod v3 `~standard`** — ✅ confirmed by Codex plan review: `zod@3.25.76`
   exposes `~standard` and `@conform-to/zod/v3/future` exports `coerceFormValue`.
6. **Conform field-name paths** — nested array errors must use `formatPath`
   serialization (`registrants[0].email`), never dotted joins (see C3 ⚠).

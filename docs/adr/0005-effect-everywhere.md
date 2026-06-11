# 5. Effect everywhere: Effect Schema validation, Effect-runtime loaders/actions, conform `/future`

Date: 2026-06-11

## Status

Accepted

## Context

ADR 0004 ported environment validation off Zod onto Effect `Config`, but the rest of the
app still ran two parallel validation/runtime stacks:

- **Validation** — seven modules imported `zod` (toast session schema, the contact /
  volunteer / newsletter form schemas, and the three registration form routes). Effect
  Schema was already a dependency (it ships inside `effect`) but was unused for app data.
- **Loaders / actions** — only 3 of 11 route modules ran through the Effect runtime
  (`routeHandler` / `routeAction`); the rest were plain `async` handlers typed with
  `LoaderFunctionArgs`, reaching for `process.env`-adjacent globals and `redirectWithToast`
  from `remix-utils` directly.
- **Forms** — conform's **classic v1 API** (`useInputControl`, `parseWithZod`, classic
  `FormProvider`), with UI primitives bound to the classic tuple shapes.

The result was a split-brain codebase: two schema libraries, two ways to fail an HTTP
request (`throw new Response` vs. Effect failures), and a form stack that could not consume
Effect Schema codecs. The sibling repo `paulo-suzanne` (ADR 0003) and the bureau
RR7+Effect integration (`/Users/cvr/Developer/work/bite/packages/bureau`) both demonstrate
a single Effect-native loader/action/form pipeline; we wanted the same here so the planned
custom CMS (ADR 0001 / CONTEXT.md) slots into one runtime rather than a second migration.

## Decision

Make Effect the **only** validation and runtime layer in the app, porting the bureau-grade
RR7+Effect integration. Executed as the `effect/everywhere` branch in seven commits
(C1–C7), each Codex-reviewed.

1. **Effect Schema is the sole validation layer.** Remove `zod` and `@conform-to/zod` from
   `package.json`; every codec — toast session payload, contact / volunteer / newsletter
   forms, the registration schema — is an Effect Schema `Schema.*`. Form-data shapes are
   modeled as codecs (string→boolean, decode-time defaults for absent checkboxes via
   `Schema.withDecodingDefault`, literal unions for enums) since conform `/future` +
   Standard Schema does **not** auto-coerce the way classic `parseWithZod` did. Validation
   messages stay **translation keys** (`Schema.isMinLength(1, { message: 'volunteer.form.name.required' })`),
   preserving the `translate(error as TranslationKey)` render contract.

2. **The Effect runtime is the sole loader/action path.** Every `loader` / `action` export
   in `app/routes/` and `app/root.tsx` goes through `routeHandler`, `routeAction`, or
   `routeFormAction` (`app/lib/effect/route.ts`, `form.ts`). Plain `LoaderFunctionArgs`
   handlers are gone. Loader/action args ride through the runtime as the
   `ReactRouterContext` service; sync data lookups (e.g. `getCurrentConference`) stay pure
   inside the generator.

3. **conform `/future` + StandardSchema.** The form stack is flipped from classic to
   `/future` in one atomic commit (the two APIs are not interoperable on shared
   primitives). `app/lib/conform.ts` is the single facade: it wires `configureForms`
   against Standard Schema (so `useForm(Schema.toStandardSchemaV1(schema), …)` validates
   with Effect Schema codecs) and re-exports the future hooks. UI primitives bind via
   `/future` `useField` + `useControl` (no `useInputControl`). Route and UI modules consume
   the configured runtime hooks/components through `~/lib/conform` rather than
   `@conform-to/react` directly (type-only imports of conform's `/future` types are exempt —
   they carry no runtime, and the facade owns the configured hooks).

4. **Tagged HTTP error taxonomy.** `app/lib/effect/errors.ts` defines
   `Schema.TaggedErrorClass` errors under a short `Http.*` namespace — `RedirectError`,
   `NotFoundError`, `BadRequestError`, `InternalServerError`, `FormValidationError`. The
   runtime (`runtime.ts`) maps each tag onto the matching React Router response
   (`redirect(url, init)`, `data(msg, { status })`) **before** the legacy raw-`Response`
   passthrough. Route effects fail with a typed error instead of `throw`-ing a `Response`,
   so redirects (with toast set-cookie headers) and 4xx/5xx flow through one mapping.

5. **Side-effectful libs are `Context.Service`s** with deterministic `gycc/...` keys; toast
   is a service (`Toast`) whose schema decode preserves the `null`-on-invalid contract so
   stale flash cookies do not 500.

The final-state invariants (zero `zod`/`@conform-to/zod` imports, zero classic conform
APIs, zero plain `LoaderFunctionArgs` handlers, zero in-effect `throw new Response`) are
greppable and verified in C7.

## Consequences

- **One validation library, one runtime.** No more zod/Effect-Schema split; no more
  classic/future conform split. New code (CMS) extends the existing Effect layer.
- **Coercion is explicit.** Classic `parseWithZod` silently coerced `''`→`undefined` and
  checkbox `'on'`→`boolean`; Standard Schema does not. Each form schema now encodes its
  form-data shape deliberately — more code, but the coercion is visible and tested rather
  than implicit. Dev-server smoke tests submit real forms to guard against drift.
- **Translation-key contract is load-bearing.** Every former zod `required_error` /
  `invalid_type_error` key reappears verbatim in a Schema check `message`. The newsletter
  schema, which previously shipped zod's **default English** messages, gained proper keys
  (`main.newsletter.*`) in both locales.
- **`@conform-to/react` range pinned honestly.** Bumped from the resolved-forward `^1.1.5`
  to `^1.19.4` (the version actually relied on for the `/future` export). `zod` survives in
  the lockfile only as an **optional** peer of `remix-utils` — no longer a direct dependency
  and not imported by app code.

### Deferred / accepted drift

- **Registration actions stay no-op.** The three registration routes are deduped into one
  `RegistrationForm` (parameterized by year) with thin wrappers; their `action`s are typed
  `routeAction` no-ops pending a product decision on submission handling. No submission
  logic was invented.
- **Toast cookie secret stays hardcoded** (`'secret-key'` in `app/lib/toast.server.ts`,
  pre-existing). Moving it to `Config.redacted` with a dev default is deferred — it is a
  config change, orthogonal to this migration.
- **`getCurrentConference` stays a pure function.** Services are for side effects; a pure
  TS data lookup does not need one, and keeping it pure avoids colliding with the planned
  CMS `Content` service.
- **CMS PR overlap.** The stacked CMS PR (#11) also touches `runtime.ts` / `server.ts`.
  Conflicts are expected and resolved at that PR's rebase, not here.

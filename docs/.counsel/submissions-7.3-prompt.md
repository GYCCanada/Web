# Codex counsel review — GYC registration-launch Branch 7, sub-commit 7.3

You are reviewing ONE just-landed commit in a stacked-PR program. Review it against the
plan, focused and scoped. Do NOT review the whole branch or earlier sub-commits except as
context. Judge ONLY commit 7.3.

## What to return

A focused review verdict with:
- **blocking**: MUST-fix-before-proceeding items. A blocker is one of: deviates from the
  plan's sub-commit 7.3 slice (does more or less than 7.3), violates a load-bearing
  principle, leaves a planned deletion undone, breaks the gate, ships an untested boundary
  the plan's test surface for THIS slice requires, or regresses behavior.
- **concerns**: non-blocking observations worth noting.
- **verdict**: a short overall judgement.

Be adversarial but fair. If it's clean, say so — do not invent blockers.

## The settled decisions (DO NOT re-litigate — these are FIXED)

- Settled #8: Submission = persisted bucket object (`submissions/<form>/<id>.json`) + email
  notification OF the record. The bucket write is the durable source of truth; the email is
  a notification of the stored record. Persist FIRST, notify SECOND — a notify failure must
  provably be unable to lose the record. Seeds a future first-party registrar (NOT built now).
- Settled #9: 2026 registration channel = RegFox. The on-site form-builder + submission
  pipeline is built and proven but NOT load-bearing for Friday. The registration server
  action is **net-new** here — the old action was a deliberate no-op (registration was
  client-validate-only in prod).
- The future first-party registrar is a DIRECTION the Submission log seeds — explicitly a
  non-goal to build now. Do not flag "no registrar / no admin list view" as a gap.
- No relational DB; content/submissions are JSON objects in the bucket. Bun `S3Client`, no
  `@aws-sdk`.

## The full plan

The complete synthesized stacked-PR plan is attached as a file:
`docs/registration-launch-plan.md`. Read it. The brief (settled decisions, non-goals) is
`docs/registration-launch-brief.md`.

## The branch this commit belongs to — Branch 7 (`reg-launch/submissions`)

Verbatim from the plan:

> **Branch 7 — `reg-launch/submissions` (CONTEXT §Submission, settled #8)**
>
> Why last: the persisted-record pipeline consumes Branch 6's generic decoder (the decoded
> value is what's persisted) and Branch 5's multi-object Storage discipline. Seeds the future
> first-party registrar. This is also where registration's net-new *server* action lands: a
> real server persist step (still not the live channel — RegFox is — but the on-site path
> becomes provable end-to-end).
>
> Module shape — SPLIT into two interfaces:
>   - `Submissions` (`app/lib/forms/submissions.server.ts`): `persist(form, decoded): Effect<Submission>`
>     — encodes the Submission, `Storage.put`s `submissions/<form>/<id>.json` (id = nanoid),
>     returns the stored record. ONE call, persistence ONLY — no mailer.
>   - A separate notifier/orchestrator step in the form action skeleton: `persist` then
>     `notify(submission)`. Bucket write is the durable source of truth; email is a
>     notification OF the stored record. Persist first, notify second; a notify failure
>     provably cannot lose the record — tested through the two separate interfaces (a mailer
>     failure still leaves `submissions/<form>/<id>.json`). Keeping `persist` strict (returns
>     the stored Submission) separate from `notify` is what makes that property provable.
>
> Schema: `Submission` = `Struct({ id, form, submittedAt, payload })`, payload **derived from
> FormDefinition** (derive-dont-sync).
>
> Read/write-path: the generic action skeleton (Branch 6) gains `persist` then `notify`
> before `toast.redirect`. The mailer call changes from "email IS the payload" to "email
> references the persisted record id".
>
> Subtract: the inline `mailer.send({ subject, content: <hand-built string> })` bodies in the
> form actions — replaced by the persist-then-notify skeleton (largely gone after Branch 6's
> skeleton; Branch 7 swaps the terminal step).
>
> Test surface: `submissions.test.ts` — persist writes the object, returns the id, round-trips
> the decoded payload; **persist-first-notify-second ordering** (a mailer failure still leaves
> the record); the registration Submission shape matches the decoded FormDefinition type.
>
> Gate + runtime proof: boot dev with an in-memory Storage test layer → submit
> contact/volunteer/registration, assert `submissions/<form>/<id>.json` exists with the
> decoded payload; mailer no-op in dev confirms the email is decoupled from the record;
> RegFox remains the 2026 live channel.
>
> Sub-commits:
>   - (7.1) `Submission` schema (payload derived from FormDefinition).  ← ALREADY LANDED
>   - (7.2) `Submissions.persist` service (persist-only) + tests.       ← ALREADY LANDED
>   - (7.3) Wire persist-then-notify into the form action skeleton; migrate
>           contact/volunteer/registration (registration's net-new server persist lands here). ← THIS COMMIT

## THIS commit — 7.3

**Commit:** `f992d6e` — `feat(forms)(submissions): wire persist-then-notify into the form action skeleton; migrate contact/volunteer/registration`

**Intent (sub-commit 7.3):** Wire persist-then-notify into the generic form action skeleton;
migrate contact/volunteer/registration. Registration's net-new *server* persist lands here.

**The diff** is attached as a file: `docs/.counsel/submissions-7.3.diff` (full `git show`).

Key context the reviewer should hold (from 7.1/7.2, already landed, NOT under review):
- `app/lib/forms/submission.ts` — `submissionSchema(definition)` factory: payload codec is
  `definitionToSchema(definition)` (the SAME codec `decodeForm` validates with). Envelope =
  `{ id: ListItemId, form: FormId, submittedAt: IsoDate, payload }`.
- `app/lib/forms/submissions.server.ts` — `Submissions.Service.persist(form, decoded):
  Effect<Submission, StorageError>`: reads definition via `Content.getForm`, mints
  `newListItemId()`, stamps `submittedAt`, encodes via `submissionSchema`, `Storage.put`s at
  `submissions/<form>/<id>.json` (key from `submissionKey(form, id)`). Persistence ONLY.
- `routeFormAction` returns `{ result: SubmissionResult, status: 'success'|'error' }`.

What this commit changes (summary; verify against the diff):
1. `runtime.ts` — wires `Submissions.layer` into the app layer alongside `DraftEditor.layer`;
   refactors `AppLayer` into `makeAppLayer(storageLayer)` + adds
   `makeRequestRuntimeFromLayer(layer)` so a test can run the real request runtime over an
   in-memory `Storage` (`layerTest`) — needed because a write can't be exercised over the
   bucket-less `Storage.layerOptional`.
2. `action.ts` — inserts `Submissions.persist(form, decoded.success)` BETWEEN decode and
   notify; `notify` now receives the stored `Submission` (its callback signature changes from
   `(decoded: DecodedForm)` to `(submission: Submission)`).
3. `contact.tsx` / `volunteer.tsx` — `notify` reads `submission.payload` (was the bare
   decoded form); mailer body otherwise unchanged.
4. `registration-action.ts` (NEW) + `registration-route.ts` (NEW) — registration's net-new
   server action: decodes `{ registrants: Array(definitionToSchema(def)) }`, persists each
   registrant as its own `Submission`, then notifies. The three `{2024,2025,2026}/form/route.tsx`
   drop their no-op `Effect.void` actions and re-export the one shared configured action;
   their components pass `actionData?.result` (was `actionData`).
5. `translations.ts` — `registration.form.error` + `registration.form.success.{title,description}`
   EN + FR.
6. `action.test.ts` — persist-then-notify wiring tests, including a persist-FIRST proof: a
   notify failure still leaves `submissions/contact/<id>.json` on the in-memory bucket.

## Gate status (verified by the implementer before counsel)

- `bun run typecheck` — clean.
- `bun run lint` — clean except ONE pre-existing `require-yield` warning in
  `app/lib/effect/form.test.ts` (NOT touched by this commit).
- `bun run build` — succeeds.
- `bun test` — 384 pass, 0 fail (the WARN log lines in output are intentional
  fallback-path logs in OTHER tests, not failures).

## Review questions (answer each)

1. **Scope fidelity.** Does the commit implement EXACTLY sub-commit 7.3's slice — wire
   persist-then-notify into the skeleton + migrate contact/volunteer/registration + land
   registration's net-new server persist — no more, no less? Flag any scope creep (work that
   belongs to a different sub-commit/branch) or any 7.3 obligation left undone.

2. **Persist-first invariant (the settled-#8 property).** Is persist provably BEFORE notify in
   BOTH the flat skeleton (`action.ts`) AND the registration action (`registration-action.ts`)?
   Is the "notify failure cannot lose the record" property genuinely TESTED end-to-end (not
   just asserted in prose)? Is the persist-first proof in `action.test.ts` sound — does it
   actually read the SAME in-memory bucket back and find the record after a notify failure?

3. **The registration split decision.** Registration does NOT flow through the flat
   `formAction` skeleton — it gets its own `registration-action.ts` because its payload is a
   repeating `{ registrants: [...] }` shell, not a flat field graph. Is that a sound
   small-interface-deep-implementation call, or does it duplicate the skeleton in a way that
   should have been unified? Does sharing `routeFormAction` + `decodeForm`'s codec +
   `Submissions.persist` keep the persist-then-notify discipline identical across both paths?

4. **derive-dont-sync.** Registration decodes the array shell against
   `Schema.Struct({ registrants: Schema.Array(definitionToSchema(definition)) })`, and each
   registrant persists via `Submissions.persist('registration', registrant)` (whose payload
   codec is also `definitionToSchema`). Is the per-registrant codec genuinely DERIVED from the
   one stored `FormDefinition`, never re-declared? Any drift hazard?

5. **migrate-callers-then-delete (subtract-before-you-add).** Are the three `Effect.void`
   no-op registration actions genuinely DELETED (not left dormant)? Do all three routes
   migrate to the shared action in the same commit (no parallel old path surviving)? Is the
   `actionData?.result` projection change correct given `routeFormAction` now returns
   `{ result, status }` where the old no-op returned `void`?

6. **make-impossible-states-unrepresentable / boundary discipline.** `notify` now takes a
   `Submission` (stored record) rather than the bare decoded form. Is that the right boundary
   — does it strengthen "the email references the persisted record"? Any place a raw decoded
   value still leaks where the stored record should be used?

7. **Test surface for THIS slice.** The plan's 7.3-relevant test surface is the
   persist-then-notify wiring + the persist-first ordering proof. Is it covered? Is there a
   MISSING test this slice specifically requires (e.g. registration's multi-registrant
   persist — does each registrant get its own object? is that proven anywhere, or only the
   contact path)? Note any gap, and judge whether it's blocking for 7.3 or deferrable.

8. **Behavior regression.** Contact/volunteer mailer bodies must be byte-identical to
   pre-commit (only the source changes from `decoded` to `submission.payload`). The honeypot
   short-circuit must still skip persist AND notify. Any regression?

9. **Gate / principles.** Any cast-to-any, stub, commented-out code, or
   correctness-over-pragmatism violation? The `makeAppLayer`/`makeRequestRuntimeFromLayer`
   refactor — is it a clean test seam (prove-it-works) or does it widen the production
   surface unnecessarily?

Return your structured verdict (blocking / concerns / verdict).

# Deep adversarial review — WHOLE PR: `reg-launch/submissions` (Branch 7)

You are Codex, performing a `--deep` holistic adversarial review of an entire
stacked-PR branch, assembled from all its sub-commits. Be rigorous and skeptical.
This is the LAST branch in a 7-branch stack realizing a synthesized plan. Your job
is to judge whether the assembled PR **fully realizes its plan section**, **coheres
across its sub-commits**, and **upholds the project's principles** — not to nitpick
style.

## What to read

1. **The full synthesized plan** (every branch, for context on the stack and the
   upstream interfaces this branch builds on):
   `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`
   — Branch 7's plan section is **"Branch 7 — `reg-launch/submissions` (CONTEXT
   §Submission, settled #8)"** near the end. Read it in full; it is the spec this PR
   must realize. Also read the "Ordering hazards" item #5 (Branch 6 before 7) and the
   "Riskiest commit" section for how the upstream form engine is pinned.

2. **The whole-PR diff** (all three sub-commits of Branch 7, assembled, diffed
   against the prior stack branch `reg-launch/form-engine`):
   `/Users/cvr/Developer/personal/gyc/docs/.counsel/submissions-WHOLE.diff`

   You MAY also read any file in the repo for context (the diff is against the parent
   branch, so upstream files like `app/lib/forms/decode.ts`,
   `app/lib/forms/definition.ts`, `app/lib/content.server.ts`,
   `app/lib/content/pages/registry.ts`, `app/lib/storage.server.ts`,
   `app/lib/effect/form.ts`, `app/lib/effect/runtime.ts` exist on disk in their
   post-PR state).

## Branch 7 plan section (verbatim, for your convenience)

> **Why last:** the persisted-record pipeline consumes Branch 6's generic decoder
> (the decoded value is what's persisted) and Branch 5's multi-object Storage
> discipline. Seeds the future first-party registrar (non-goal to build the
> registrar; build the seed). This is also where registration's net-new *server*
> action lands (the phantom-decode consequence): registration gains a real server
> persist step here (still not the live channel — RegFox is — but the on-site path
> becomes provable end-to-end).
>
> **Module shape — resolves both reviews' "persist must be separable from notify"
> concern by SPLITTING into two interfaces:**
> - **`Submissions` (new, `app/lib/forms/submissions.server.ts`):**
>   `persist(form, decoded): Effect<Submission>` — encodes the `Submission`,
>   `Storage.put`s `submissions/<form>/<id>.json` (id = nanoid), returns the stored
>   record. **One call, persistence ONLY — no mailer.**
> - **A separate notifier/orchestrator step** in the form action skeleton: `persist`
>   then `notify(submission)`. The bucket write is the durable source of truth; the
>   email is a notification OF the stored record (settled #8, CONTEXT
>   §Submission:48). **Persist first, notify second; a notify failure provably cannot
>   lose the record** — tested through the two separate interfaces (a mailer failure
>   still leaves `submissions/<form>/<id>.json`). Keeping `persist` strict (returns
>   the stored `Submission`) separate from `notify` is what makes that property
>   provable.
>
> **Schema changes:** `Submission` schema (`forms/submission.ts`) =
> `Struct({ id, form, submittedAt, payload })`. Per-form `payload` typing **derived
> from the `FormDefinition`** (derive-dont-sync — the submission shape is the decoded
> form type, not re-declared).
>
> **Read/write-path:** the generic action skeleton (Branch 6) gains `persist` then
> `notify` before `toast.redirect`. The mailer call changes from "email IS the
> payload" to "email references the persisted record id".
>
> **Subtract:** the inline `mailer.send({ subject, content: <hand-built string> })`
> bodies in the form actions — replaced by the persist-then-notify skeleton.
>
> **Test surface:** `submissions.test.ts` — `persist` writes the object, returns the
> id, round-trips the decoded payload; **persist-first-notify-second ordering** (a
> mailer failure still leaves the record); the registration `Submission` shape
> matches the decoded `FormDefinition` type.
>
> **Gate + runtime proof:** boot dev with an in-memory `Storage` test layer → submit
> contact/volunteer/registration, assert `submissions/<form>/<id>.json` exists with
> the decoded payload; mailer no-op in dev confirms the email is decoupled from the
> record; RegFox remains the 2026 live channel.
>
> **Sub-commits:**
> - (7.1) `Submission` schema (payload derived from `FormDefinition`).
> - (7.2) `Submissions.persist` service (persist-only) + tests.
> - (7.3) Wire persist-then-notify into the form action skeleton; migrate
>   contact/volunteer/registration (registration's net-new server persist lands here).

## What I need from you — a holistic, adversarial whole-PR review

Judge the ASSEMBLED PR, not individual lines. Answer concretely:

1. **Plan realization.** Does the PR fully realize the Branch 7 section?
   - Is the `persist` / `notify` SPLIT real (two genuinely separate interfaces), or
     is `notify` baked into `persist` in a way that makes "persist-first" unprovable?
   - Is the `Submission` payload **derived** from the `FormDefinition`
     (`derive-dont-sync`), or is there a parallel per-form payload struct that could
     drift? Scrutinize `app/lib/forms/submission.ts`'s `submissionSchema` factory.
   - Is registration's **net-new server persist** actually landed and wired into all
     three year shells (`2024/2025/2026/form`)? Is the old no-op action deleted (not
     left dormant)?

2. **Interface depth** (`small-interface-deep-implementation`). Is `Submissions` a
   small surface (one `persist` op) over a deep implementation, or is it shallow
   plumbing? Is the action skeleton's `notify` callback the right seam, or leaky?

3. **ALL deletions made / no dead code between slices** (`subtract-before-you-add`,
   `migrate-callers-then-delete-legacy-apis`). The "Subtract" item says the inline
   `mailer.send(...)` bodies are replaced by the persist-then-notify skeleton. Verify
   no half-migrated caller remains: did contact, volunteer, AND all three
   registration routes migrate, with the old no-op / inline mailer bodies genuinely
   gone? Any orphaned import, dead helper, or dual pipeline left behind?

4. **No behavior regression.** Contact/volunteer ran server-side decode before;
   registration was client-only. After this PR:
   - Do contact/volunteer still validate + notify identically (the mailer body is the
     same content, now over the persisted record's payload)?
   - Does the registration field-error path still key at the conform field names the
     live form renders (`registrants[n].<field>`)? See
     `app/lib/forms/registration-action.ts` decoding
     `Schema.Struct({ registrants: Array(definitionToSchema(def)) })`.

5. **Principles upheld** — `make-impossible-states-unrepresentable` (closed `FormId`,
   branded `ListItemId`/`IsoDate`, `submissionKey` derived not hand-typed),
   `boundary-discipline`, `correctness-over-pragmatism` (NO cast-to-any, NO stubs, NO
   commenting-out). Flag any `as any`, `as unknown as`, `// TODO`, or
   `throw new Error("not implemented")`.

6. **Scrutinize the riskiest parts HARDEST:**
   - **The persist-first-notify-second durability property.** Is it ACTUALLY proven
     that a `notify` failure cannot lose the record? Trace the action skeleton
     (`app/lib/forms/action.ts`) and registration action: is `persist` fully
     committed (the `Storage.put` resolved) BEFORE `notify` runs? In the registration
     array path, if registrant #2's persist fails after #1 succeeded, what is the
     state — is that an acceptable partial-write, or a correctness hole? Is there a
     test that a mailer failure leaves the bucket object intact (both for the flat
     skeleton AND the registration array)?
   - **The `submittedAt` / id derivation.** `Submissions.persist` mints `id` via
     `newListItemId()` and stamps `submittedAt` from the `Clock`. Is the
     `Effect.orDie` on the `IsoDate` decode justified (a clock-derived `YYYY-MM-DD` is
     always a real calendar date), or could it die on a legitimate input?
   - **The encode-as-validation.** `persist` does
     `Schema.encodeUnknownEffect(Schema.fromJsonString(schema))(submission)` with
     `Effect.orDie`. Is "a decoded form ALWAYS re-encodes" a sound invariant, or could
     a `decoded` value from `decodeForm` fail to re-encode through the derived codec
     (e.g. a kind whose decode and encode aren't inverse)? This is the
     `derive-dont-sync` linchpin — if it's unsound, persist dies on a valid
     submission.
   - **Runtime wiring** (`app/lib/effect/runtime.ts`). The PR refactors `AppLayer`
     into `makeAppLayer(storageLayer)` so the write path can be tested end-to-end
     against an in-memory bucket. Is `Submissions.layer` correctly merged so it shares
     the SAME `Content`/`Storage` instance (no second coordinated instance)? Does the
     test seam (`makeRequestRuntimeFromLayer`) faithfully exercise the real pipeline?

7. **Cohesion across sub-commits.** 7.1 (schema) → 7.2 (service) → 7.3 (wiring +
   migration). Is each independently coherent, or does the assembled whole leave a
   seam (e.g. a type declared in 7.1 only used in 7.3, a service in 7.2 with no
   caller until 7.3 — acceptable for a stack, but flag genuine dead-between-slices)?

## Output format

Lead with a one-line **verdict**: does the assembled PR fully realize Branch 7 and
is it safe to merge on top of the stack? Then:

- **BLOCKING** issues (must-fix before merge): plan deviation, principle violation,
  incomplete deletion / half-migrated caller, a real durability/correctness hole, an
  unsound `orDie` invariant, broken test seam, behavior regression. Be specific —
  cite file + line.
- **CONCERNS** (non-blocking, worth noting).
- If you find NOTHING blocking, say so explicitly — do not invent issues to seem
  thorough.

Cite specific files/lines (full paths) for every claim so the implementing agent can
act without re-discovering.

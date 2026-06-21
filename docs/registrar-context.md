# Registrar planning — grounded context (read before planning)

> Scratch context for the registrar planify workflow. Captures the existing engine,
> the reference repos, and the domain problem so planning agents don't re-derive it.

## The goal (user's words)

Build a **registrar**: accept any form type via the CMS (radio, checkbox, input) —
but these fields can have **consequences to the total price**. There's also
**timing** (early-bird, etc.). Integrate **Stripe** (PaymentIntents + webhooks) via
the Effect-native distilled SDK.

So the registrar = the existing data-driven form engine + a **pricing dimension**
(field choices → price deltas) + **time-window modifiers** (early bird) +
**payment** (Stripe) + the **Submission** record as the source of truth.

## What exists today (the foundation — DO NOT rebuild)

A mature, data-driven form engine. Key files (all under `app/lib/`):

- `forms/definition.ts` — the `FormDefinition` Schema: a CMS-editable JSON object
  (`forms/<form>.json`) describing one form. The CLOSED `FieldKind` tagged union
  (~8 kinds): `requiredText`, `optionalText`, `email`, `url`, `literal` (radio),
  `checkboxBoolean`, `arrayOfLiteral` (multi-select), `nestedGroup` (recursive).
  Plus a discriminated-union `variant` (e.g. attendee/exhibitor) and cross-field
  `rules` (`requiredWhenEquals`). `FieldOption = { value: OptionValue, label: Text }`.
  All author strings are bilingual `Text`; error messages are `MessageKey` (a real
  `TranslationKey`, validated at decode). `make-impossible-states-unrepresentable`:
  a definition cannot invent a field type outside the closed set.
- `forms/decode.ts` — `definitionToSchema(definition)`: compiles a `FormDefinition`
  into a server-side Effect Schema that validates a submission. The generic decoder.
- `forms/render.tsx` — generic renderer: `FormDefinition` → rendered React form.
- `forms/submission.ts` — `submissionSchema(definition)`: the persisted `Submission`
  envelope (`{ id, form, submittedAt, payload }`) where `payload`'s codec IS
  `definitionToSchema(definition)` (`derive-dont-sync` — never re-declared).
- `forms/submissions.server.ts` — `Submissions.persist` (bucket object
  `submissions/<form>/<id>.json`). Idempotent persist (a recent fix).
- `forms/action.ts` / `registration-action.ts` — the submit action skeleton
  (validate → persist → notify-email).
- `content/pages/registry.ts` — `FormId = 'contact' | 'volunteer' | 'registration'`
  (closed); `formObjectKey`, `submissionKey`. `FORM_SPECS` (schema+default per form).
- `content.server.ts` — `Content.getForm(id)` reads `forms/<form>.json` (runtime CMS
  read, per-object cache + TTL + bust). Falls back to bundled default on failure.
- `storage.server.ts` — the bucket `Storage` service (S3/MinIO; in-memory test layer).

There is **NO pricing, payment, Stripe, or money code anywhere today** (verified by
grep). The registrar is greenfield ON TOP of this engine.

### Critical domain context (ADR 0007, `docs/adr/0007-structural-form-builder.md`)

- Forms are **data** ("the form itself is part of the schema"); the field graph is
  editable only within the closed kind-set.
- Submissions persist as bucket objects + email notification, **"seeding a possible
  future first-party registrar"** — THIS registrar is that future. "A later
  first-party registrar reads the registration Submission log."
- For 2026 the live registration channel is **RegFox** (the Conference's
  `registrationUrl`); the on-site form is built+proven but not yet load-bearing. The
  registrar would make the first-party path load-bearing (incl. taking money).

### Patterns the codebase already commits to (honor these)

- **Effect v4 / smol** (`effect@4.0.0-beta.60`): `Context.Service`, `Layer`, `Schema`
  (smol module layout), `Effect.fn`, tagged errors, `Config`/`Redacted` for secrets.
- Runtime-read CMS: a new field/key on a published object needs a **read-boundary
  backfill** on BOTH the public read AND the `/admin` draft read, or legacy content
  drops it (recurring hazard — see `content/pages/home-photo-backfill.ts`,
  `backfillListItemIds`, the `getTranslations` static-merge).
- `derive-dont-sync`, `make-impossible-states-unrepresentable`,
  `boundary-discipline`, `subtract-before-you-add`, `small-interface-deep-implementation`.
- Per-object bucket storage (ADR 0008); stable list-item ids (ADR 0006).
- Idempotency matters (registration persist idempotency was a recent fix; Stripe
  idempotency keys exist for exactly this).

## Reference repos (cached locally — cite file:line)

1. **`alchemy-run/distilled`** → `/Users/cvr/.cache/repo/alchemy-run/distilled`
   The Effect-native Stripe SDK. Package `packages/stripe/` (`@distilled.cloud/stripe`):
   - `src/client.ts` — `makeAPI`, Stripe error matching, request options
     (idempotencyKey, apiVersion, Stripe-Account). Uses `effect/Schema`,
     `effect/Redacted` — the **v4/smol module layout, matching our effect version**.
   - `src/operations/PostPaymentIntents.ts` — `PostPaymentIntents({ amount, currency,
     ... })`; amount in minor units, typed input Schema.
   - `src/webhooks.ts` — `verifySignature` / `constructEvent` (HMAC, timestamp
     tolerance `DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300`, raw-body discipline). Typed
     `StripeWebhookSignatureError` / `StripeWebhookPayloadParseError`.
   - `src/credentials.ts` — `Credentials` / `CredentialsFromEnv` layer (`STRIPE_API_KEY`).
   - `src/errors.ts` — typed errors: `CardError`, `InvalidRequestError`,
     `IdempotencyError`, `UnknownStripeError`, … dispatched via `Effect.catchTags`.
   NOTE: it's a peer-dep-on-effect generated SDK. Decide: depend on the published
   package vs. vendor the few operations we need. Check its license + publish status.

2. **`anomalyco/opencode`** → `/Users/cvr/.cache/repo/anomalyco/opencode`
   Effect application architecture / patterns reference. Use for: service/layer
   composition, error strategy, config, module boundaries — to keep the registrar's
   Pricing/Payment/Registrar services idiomatic.

3. **`effect-ts/effect-smol`** → `/Users/cvr/.cache/repo/effect-ts/effect-smol`
   The Effect v4 source. Use to verify exact APIs (Schema combinators, `Config`,
   `Redacted`, HttpClient, `Effect.fn`, error classes) against OUR beta — not v3 docs.

## The core modeling questions the plan MUST answer

1. **Where does price live?** A price contribution attached to: a `FieldOption`
   (radio/checkbox choice), a `checkboxBoolean` (on = +$X), a quantity input? Is it a
   new optional field on the existing kinds, or a separate parallel "pricing rules"
   structure keyed by field-name/option-value? (Trade-off: inline on options =
   cohesive but widens every kind; separate rules = `subtract-before-you-add` but a
   sync hazard. `derive-dont-sync` should settle it.)
2. **How is the total computed?** A pure function `price(definition, submission) →
   Money` evaluated server-side (never trust client math). Currency/minor-units
   modeling (a `Money` brand). Must be the SAME source the client preview uses
   (derive the preview from the rule set, don't reimplement).
3. **Timing / early-bird.** Time-window modifiers: a window `{ from, to }` with a
   price delta or an override tier. Evaluated against submit time (server clock,
   `Clock`), not client time. How do windows compose with per-field deltas? Tiered
   base price vs. additive discount?
4. **Payment integration.** PaymentIntent created server-side for the computed amount
   (idempotency key derived from the submission id — ties to the existing persist
   idempotency). Webhook (`payment_intent.succeeded`) confirms + marks the Submission
   paid. The Submission stays the source of truth; payment status is a field on it.
   Order of operations: persist submission (pending) → create intent → client confirms
   → webhook marks paid. Failure/abandonment handling.
5. **CMS authoring + the backfill hazard.** Pricing rules are CMS-editable data on the
   form object → `/admin` editor surface + the legacy-object read-boundary backfill so
   adding pricing to a published `forms/registration.json` doesn't break decode.
6. **Trust + security boundary.** Server recomputes the price; the client preview is
   advisory. Stripe amount is set server-side. Webhook signature verified. No price in
   client-controlled form data is ever trusted.
7. **Scope/sequencing for 2026.** RegFox is the live channel; the registrar can land
   behind a flag / in test mode. What's the smallest correct first slice?

## NEW REQUIREMENT — conditional / dependent fields (and their pricing)

Some form fields are **contingent on a previous option being selected** ("show field B
only if option A is chosen"). This is a real modeling + pricing dimension the plan MUST
cover.

What the engine has TODAY (verified):
- `variant` (`definition.ts:516`, `FormVariantSet`) — a discriminated-union section:
  whole field-sets are contingent on a discriminator value (attendee vs exhibitor).
  This is the ONLY current "whole groups depend on a choice" mechanism.
- `requiredWhenEquals` (`CrossFieldRule`, `definition.ts:490`) — a cross-field
  *validation* rule (target field is required when `when` field equals one of `equals`).
  It governs PRESENCE/REQUIREMENT, not visibility.
- There is **NO conditional VISIBILITY/ACTIVATION model** — nothing that says
  "field B is only shown/active when field A == optionX" outside the variant split.

What the registrar needs (the plan must decide):
- A **conditional-activation model**: a field (or nestedGroup) is *active* only when a
  predicate over an earlier field's value holds (e.g. `when 'addBanquet' == 'yes'` →
  the `banquetGuests` quantity field is shown). Likely a `CrossFieldRule`-family
  addition (`visibleWhenEquals` / a per-field `activeWhen`), modelled as a closed tagged
  predicate (NOT a free-form expression — `make-impossible-states-unrepresentable`),
  with a decode-time reference-integrity filter (the `when` field + values must exist),
  mirroring `variantsMatchOptions` / `requiredWhenEquals`.
- **Pricing consequence (critical):** an INACTIVE field must NOT contribute to the
  total. `price(definition, decoded, now)` must skip a pricing rule whose field is
  inactive under the submission's chosen values — and the **same activation predicate**
  drives the rendered form (hide), the validation (don't require a hidden field), AND
  the price (don't charge for a hidden field). One predicate, three consumers
  (`derive-dont-sync`): the activation evaluator is shared, never re-implemented per
  consumer. A submission that smuggles a value for an inactive field is rejected/ignored
  (out-of-form payload), consistent with how the decoder already treats the
  always-rendered-vs-conditional split.
- **Trust:** activation is recomputed server-side from the decoded values; the client's
  show/hide is advisory, exactly like the price. The server never trusts a
  client-asserted "this field was active."
- **Composition with variant:** activation predicates live WITHIN a variant's field
  graph and within nestedGroups; the plan must say how a predicate references a sibling
  field vs a field in an enclosing scope (keep it simple: same-scope sibling reference
  for v1, document deeper scoping as a follow-up if needed).
- **Sequencing:** this can be its own commit(s) layered after the core pricing
  evaluator (the evaluator gains an "is this field active?" guard); the activation
  model + its decode-time integrity filter + the price/validation/render wiring should
  be a coherent slice.

### CLARIFICATION — keep ACTIVATION and PRICE-CONTRIBUTION orthogonal

Two distinct axes the plan MUST NOT conflate:

1. **Activation / visibility** — a field is shown + active when a predicate over an
   earlier field's value holds. **"Required" can be TIED to activation**: a field that is
   only visible-when-X is also only required-when-X. So the existing `requiredWhenEquals`
   and the new `visibleWhen` are the SAME predicate family — *required-ness can derive
   from visibility* (a hidden field is not required; an active field may be required).
   The plan should unify these rather than build two parallel predicate mechanisms
   (`subtract-before-you-add`): ONE shared `isActive(field, decoded)` predicate gates
   render (hide), validation (don't require a hidden field), AND price-eligibility.

2. **Price contribution** — a SEPARATE axis. A field being required/active does NOT mean
   it contributes to the price, and contributing does NOT require being required. All
   four combinations must be representable:
   - active ∧ required ∧ priced (e.g. a mandatory paid add-on shown only for attendees)
   - active ∧ required ∧ unpriced (a mandatory free question)
   - active ∧ optional ∧ priced (an opt-in surcharge)
   - active ∧ optional ∧ unpriced (a free optional question)

   So: `isActive` GATES whether a pricing rule for that field is even evaluated, but
   WHETHER an active field contributes is determined solely by the existence of a pricing
   rule for it — never inferred from required-ness or from activation. An active field
   with no pricing rule contributes 0; an inactive field contributes 0 regardless of any
   pricing rule it has. Price-eligibility = `isActive(field) ∧ ∃ pricingRule(field)` —
   two independent predicates AND-ed, not one implying the other.

This means the model has THREE independent things keyed by field/option: (a) the
activation predicate (drives render+required+price-gating), (b) the required-ness (may
derive from activation, or be unconditional), (c) the pricing rule (independent; may be
absent). The plan must show these as orthogonal in the schema and in `price()` /
`isActive()` / the decoder.

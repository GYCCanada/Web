# Registrar implementation plan — synthesis (authoritative)

> **Status: planning artifact.** This is the final, commit-broken implementation plan for the
> GYC first-party **registrar** — the existing data-driven form engine + a pricing dimension
> (field choices → price deltas) + time-window modifiers (early-bird) + conditional/dependent
> fields + Stripe payment, with the `Submission` record as the source of truth.
>
> Grounded against `docs/registrar-context.md` (the goal, the engine inventory, the
> conditional-fields requirement, and the **activation-vs-price orthogonality** clarification).
> It synthesizes the two independent plans + their adversarial reviews + the two conditional-field
> designs, resolving every divergence with the stronger argument.
>
> **RegFox remains the live 2026 registration channel** (the Conference's `registrationUrl`).
> The registrar lands **behind the `Env.stripe` `None`-gate** (Stripe test mode) — the on-site
> first-party path is built and proven but not load-bearing until the gate flips. Nothing in
> this plan changes any existing form (contact/volunteer) or the live RegFox channel.
>
> **Execution cadence:** each commit is built, gated green standalone, then reviewed by Codex
> counsel (per-commit), with a final `--deep` whole-PR counsel review before the PR opens.
> **Gate per commit:** `bun test` + (`react-router typegen && tsgo --noEmit`) + `oxlint`
> (`package.json:9-15`).

---

## 1. Architecture & key decisions

Eight decisions, each resolved definitively (chosen / rejected / one-line rationale). All schema
sketches are real Effect v4 / smol (`effect@4.0.0-beta.60`), mirroring the engine's own idioms.

### Decision 1 — Pricing location: **separate `PricingRules` keyed by field/option, NOT inline on `FieldOption`**

**Chosen:** an `optionalKey` `pricing?: PricingRules` field on `FormDefinition` (`definition.ts:512`),
a separate tagged structure keyed by `FieldName` (+ `OptionValue`), guarded by a decode-time
reference-integrity filter.
**Rejected:** Codex's inline `price` on `FieldOption` / `priceWhenTrue` on `checkboxBoolean`.
**Rationale:** `FieldOption` (`definition.ts:104`) → `OptionList` (`:119`) is **reused by the
variant discriminator** (`FormVariantSet.options: OptionList`, `:459`), where a per-option price
is meaningless — and confirmed dual-rendered as both priced choices and the discriminator radio
(render.tsx `VariantSection` at `:263-269`). Inline pricing makes "price on a discriminator
option" a *representable-but-meaningless* state (a `make-impossible-states-unrepresentable`
violation). A separate keyed structure adds **one** top-level field instead of widening every
option-bearing kind, honoring ADR 0007's minimal author surface and `subtract-before-you-add`.
The apparent `derive-dont-sync` objection (a rule could reference a field/option that doesn't
exist) is closed at the decode boundary by a `Schema.makeFilter` on `FormDefinition` walking the
rules against the actual field graph — the **exact bijection idiom `variantsMatchOptions`
already uses** (`definition.ts:402-432`). Drift becomes a decode-time impossibility, which is
strictly stronger than inline (inline still cannot express base price or timing windows, which
are form-level — you'd end up with a hybrid anyway). **Both reviews independently reached this
verdict** (Claude review §"What the plan got RIGHT"; Codex-main review head-to-head table).

Keep from Codex: the **money brands** (branded minor units + one form-level currency) and the
**single pure shared evaluator** — just key the evaluator off the separate rules.

### Decision 2 — Multi-registrant payment cardinality: **registrant chooses group vs per-registrant at checkout; one order record per resulting intent, keyed off the request fingerprint + chosen mode**

> **Note:** the *placement* of the mode selector + payer + labels is re-designed in **Decision 2b
> (REPLACEMENT)** — they are a CMS-authored `party` section on `FormDefinition`, not a `billingModes`
> field on `PricingRules` and not a route-static selector. This Decision 2 keeps the **cardinality
> mechanics** (one-vs-N intents, fingerprint+mode idempotency keys, the order record); read it through
> the 2b lens (the allow-list is `party.billingMode.options`; the group payer is the nominated
> `party.payer`, not `registrants[0]`).

**Chosen:** billing cardinality is a **party-facing choice made at checkout** (per *submission*, NOT
a per-form hard-coded flag) — the party picks "pay for everyone" (`group`) vs "everyone pays their
own" (`perRegistrant`). The form *constrains* which modes are offered (the authored
`party.billingMode.options`, default group-only; Decision 2b), but the selection rides in the
submission. `group` ⇒ one PaymentIntent for the party sum + one order record;
`perRegistrant` ⇒ one PaymentIntent + one order record per registrant. The Stripe idempotency key
derives from the **request fingerprint + the chosen mode (+ registrant index for perRegistrant)**:
`registration:checkout:${requestFingerprint}:${mode}` (group) or
`…:${requestFingerprint}:perRegistrant:${index}` — NOT from any registrant's submission id, and
distinct per mode so a retry that switches mode doesn't collide on a stale intent.
**Rejected (CMS-authored per-form `billingMode`):** the org would hard-code one cardinality per
form; but who pays is the *registrant's* call (a youth group leader paying for 8 vs 8 individuals
each paying themselves), so it belongs on the submission, gated by what the form allows.
**Rejected (group-only, no choice):** a family of 4 paying together is the common case, but forcing
it blocks the "each pays their own" path the org wants configurable.
**Rejected (Codex's "first submission id as group id"):** **unstable across retries → double-charge.**
The per-registrant ids are `deterministicListItemId('registration:${sha256(JSON.stringify(payload))}:${index}')`
(`registration-action.ts:125-134`) — the fingerprint hashes the *entire* registrant array. Editing
or reordering ANY registrant changes the fingerprint → registrant[0]'s id changes → the "group id"
changes → the idempotency key changes → Stripe mints a *new* intent for a charge that may already
be in flight.
**Rationale & mechanics:** the request fingerprint is *already* the stability anchor the persist
loop relies on (`registration-action.ts:125`). Key each PaymentIntent off it directly:
`registration:checkout:${requestFingerprint}:${mode}` (group) / `…:${requestFingerprint}:perRegistrant:${index}`.
A verbatim retry re-derives the same fingerprint →
same key → Stripe replays the first intent (no double-charge); a genuinely-new submission (any
payload change) gets a new fingerprint → a new checkout, which is correct (the price may differ).
`price()` is computed **per registrant** (Decision 4). For `group`, the per-registrant prices are
**summed** and the sum is frozen onto a single order record
(`submissions/registration/orders/${requestFingerprint}.json`, `orderId = requestFingerprint`,
`registrantIds` = the whole party). For `perRegistrant`, each registrant's own price is frozen onto
its own order record (`…/orders/${requestFingerprint}:${index}.json`,
`orderId = ${requestFingerprint}:${index}`, `registrantIds` = the one id). Either way the amount is
frozen at create-intent time (Decision 7). The order record is a new bucket object — it does not
exist today (confirmed: registration owns only the `{registrants:[]}` shell and one Submission per
registrant). The webhook flips the matching order record AND its registrant submission(s)' `payment`
to `paid`. The chosen `mode` is persisted on each registrant's `PaymentState` so the webhook and any
future read-back know which order(s) to reconcile.

### Decision 2b — CMS-authored party scope + nominatable payer + billing mode (REPLACEMENT)

> **Supersedes the prior Decision 2b in full.** The four 2027 product constraints (perRegistrant in scope; non-leader registrant email optional in group; the payer is a *nominatable* identity, possibly a non-attendee; the mode selector + payer block + their labels are CMS-authored, not route-static JSX) invalidate the prior design's four premises (payer = `registrants[0]`, email-required-in-both-modes, route-static labels, route-owned-shell-with-no-CMS-surface). This re-design reconciles the CLAUDE and CODEX party-scope designs and their two adversarial reviews, fixing every blocker.
>
> **Ground truth re-verified this pass (cite these, they override any conflicting prose):**
> - `FormDefinition` is `{ title, intro?, fields, variant?, rules? }` with **no `.check` today** (`definition.ts:512-518`); `variant`/`rules` are already `optionalKey` non-`FieldKind` sibling SECTIONS (`:516-517`).
> - The `email` `FieldKind` **carries an `optional` arm**: `optional: Schema.optionalKey(Schema.Boolean)` (`definition.ts:327`); the decoder implements it (`decode.ts:239-253`: optional-at-key, non-empty-when-present, mirroring contact/volunteer's gated email). The registration `email` instance (`app/lib/content/pages/defaults.ts:751-757`) **omits** `optional` — so the relaxation is a one-field DATA edit, not a kind-shape change. **The prior plan's "email has no optional arm" (an earlier draft of this plan) is factually wrong against the tree.**
> - `itemIdentity` (`admin-form.ts:152-156`) keys merge identity on **`id` or `slug` ONLY** — never `value`. `FieldOption` is `{value, label}` with no `id` (`definition.ts:104-108`). **An array-by-`value` `deepMerge` does NOT exist** — both source designs asserted it falsely.
> - `MessageKey` validates against `TRANSLATION_KEYS = new Set(Object.keys(root.en))` (`definition.ts:52,72`), where `root` is the **statically bundled** translations import. New message-key *tokens* require a source deploy; their en/fr *strings* are CMS-editable via the `t:<locale>:<key>` channel (`admin-form.ts:112-141`).
> - The registration route owns `Schema.Struct({ registrants: Array(definitionToSchema(definition)) })` (`registration-action.ts:102-104`), decoded once; the client `RegistrationFormShape` is a separate static type cast on via `as unknown as` (`registration-form.tsx:112-124`).
> - `FORM_SPECS.registration = pageSpec(FormDefinition, …)` — strict, **no `normalize`, no laxer draft schema** (`registry.ts:232`); all three forms share `FormDefinition`. A *required* new key fails decode on every published `forms/*.json` (the backfill hazard).

#### 2b.1 — WHERE the party scope lives: a `party?: PartySection` `optionalKey` sibling on `FormDefinition`

**Chosen:** a new **`party: Schema.optionalKey(PartySection)`** key on `FormDefinition` (`definition.ts:512`), a fifth top-level sibling of `title`/`fields`/`variant`/`rules`.

**Rejected — a ninth `FieldKind`:** the closed 8-kind invariant (`definition.ts:29,236,312-367`) governs only what a leaf in a `FieldList` may be — kinds the decoder compiles per-registrant via `fieldToStructEntry` (`decode.ts:212-255`) and the renderer draws as one control. The party scope is none of those: it is decoded **once per submission** (like the shell), never enters a `FieldList`, never widens the hand-written recursive `FieldKindShape` mirror (`definition.ts:136-183`). That mirror — the cost the closed-union invariant protects — is **untouched**.

**Rejected — a registration-only wrapper schema, or a raw route-shell struct (the prior Decision 2b.1):** the prior plan put `billingMode` on the hand-written `Schema.Struct({ registrants })`, which has **no CMS surface** — built in route code, never authored, never localized. Constraint 4 explicitly kills this. `FormDefinition` is the only struct that (a) round-trips to `forms/registration.json`, (b) decodes through `FORM_SPECS.registration` on both public and `/admin` draft reads, (c) flows through the `deepMerge` authoring path. Anywhere else re-invents all three.

**Rationale — the precedent is load-bearing and exact:** `variant` (`FormVariantSet`, `:457-463`) and `rules` (`CrossFieldRule[]`, `:490-498`) are *already* authored top-level sections that are NOT `FieldKind`s. Adding `party` is precisely what adding `variant` was: a new authored sibling, zero new `FieldKind` (`subtract-before-you-add` — reuse the section mechanism `variant` proved). The brief's own framing confirms the altitude ("a sibling of `fields`/`variant`/`rules` … a new top-level authored section, not a new FieldKind").

**`optionalKey`, not required** — dodges the backfill hazard at the schema level (`registry.ts:232` is `pageSpec`, strict, no `normalize`). A required `party` fails decode on the published contact/volunteer/registration docs (all share `FormDefinition`). `optionalKey` mirrors `variant`/`rules` exactly: **absence ⇒ no party section** (contact/volunteer are single-submission, will always omit it; legacy published `registration.json` keeps decoding until re-authored).

**Generalizes-but-registration-is-the-only-consumer:** the *schema* is general (any form could author a `party`); the *consumers* are registration-specific (only the registration route has the `{ registrants: [...] }` repeater and fans out per-registrant intents). Same split as `variant`: general schema, registration-only structural use.

#### 2b.2 — The PAYER model: a `mode`-discriminated DECODED party, payer present iff `group` (impossible states unrepresentable)

Two layers — keep them distinct (this is where both source designs were slightly muddled):

**(a) The AUTHORED `PartySection`** (on `FormDefinition`, in `forms/registration.json`) declares the *available* modes + the *labels/chrome* for the mode selector and the payer block. It is NOT mode-discriminated — a form offers *both* modes for the party to choose between.

**(b) The DECODED party** (the submission value, route-owned shell) is a **tagged union over the chosen mode** — this is where impossible states die:

```ts
type DecodedParty =
  | { readonly _tag: 'group'; readonly payer: Payer }   // exactly one nominated payer
  | { readonly _tag: 'perRegistrant' };                 // no payer — each registrant self-pays
type Payer = { readonly name: string; readonly email: string };
```

**Chosen — payer is a type-level-distinct identity, present ONLY in the `group` arm.**
**Rejected — payer = `registrants[0]` (prior Decision 2b.3):** Constraint 3 invalidates it — a nominated non-attending payer (a parent paying for a youth group) is *not in the registrants array at all* (`registration-form.tsx:223` seeds an attendee). **Rejected — `payer?: Payer` optional field:** would make "perRegistrant + a payer" and "group with no payer" both representable-but-wrong. The tagged union forecloses both — `make-impossible-states-unrepresentable` exactly: you cannot decode a payer in `perRegistrant`, and `group` cannot decode without one.

**Payer SHAPE is fixed (name + required email), not an open field graph** — a payer is exactly an addressable receipt recipient, so it is a `Payer = {name, email}`, not an arbitrary `FieldList`. This is the second impossible-state win.

**[MAJOR fix — authored `payer` is `optionalKey` + an integrity filter, not always-required]** Both source designs made the authored `payer` a *required* sub-struct of `PartySection`, then admitted the "group ⇒ payer authored" integrity filter was dead (always true). That accepts a representable-but-meaningless state: authored payer copy on a `perRegistrant`-only form. **Fix:** `payer: Schema.optionalKey(PayerFields)` on `PartySection`, and add the real biconditional to the combined `FormDefinition.check`: **`'group' ∈ billingMode.options  ⟺  party.payer present`**. A `perRegistrant`-only form authors no payer block; a `group`-offering form must. This restores the invariant and earns the filter its keep (it composes into the single accumulating `.check` the plan already introduces in C4a — Risk 6).

**How payer email feeds `receipt_email`:** the decoded `group`-arm `payer.email` is frozen onto `RegistrationOrder.receiptEmail` (`Schema.String`, required — see the RegistrationOrder schema above) at create-intent (Decision 7 step 3), then threaded to `PostPaymentIntents.receipt_email` (`:517`). In `group` there is ONE order ⇒ `receiptEmail = payer.email`. In `perRegistrant` there is no party payer ⇒ order_i `receiptEmail = registrants[i].email`. The freeze discipline is unchanged; only the *source* moves.

#### 2b.3 — Email relaxation: a SHELL/UI item (NOT a one-field data edit — `--deep` BLOCKER)

**Correction over the prior framing:** the `email` kind DOES have an `optional` arm (`definition.ts:327`, `decode.ts:239-253`) — that part was right. But `optional: true` is **optional-at-key, non-empty-WHEN-PRESENT**: an *absent* key decodes valid, a *present blank* `''` still rejects. And the default registrant **renders `email: ''`** (`registration-form.tsx:134-137`), which the browser POSTs as a present blank; `parseSubmission` keeps present `''` (no `stripEmptyValues` — pinned by `action.test.ts:120-128,168-181`). **So flipping `optional: true` ALONE does not make "group blank non-leader passes" — the blank still rejects.** This is a SHELL/UI item, not a pure data toggle.

The relaxation has **three** parts:
1. **Authored:** flip the registration `email` instance (`pages/defaults.ts:751-757`) to `optional: true` (optional-at-key).
2. **Shell normalization (the new load-bearing piece):** in the `group` arm, the shell **drops blank registrant emails** (`email === '' ⇒ delete`) before the per-registrant codec runs, so an un-filled non-leader email decodes as *absent* (valid) rather than *present-blank* (rejected). Mirror the `group`-only normalization to the registrant list; do NOT touch the payer email (required) or `perRegistrant` (all required). *(Alternative considered — the UI omits the email input's `name` when left blank — rejected: brittle, and the parity test wants a stable submit-name set. Shell normalization is the server-trusted boundary.)*
3. **Payer email required:** the `group`-arm `Payer` decodes `email` through the existing `email()` codec (`decode.ts:114-121`) — required by construction.

**Mode-conditional requiredness re-imposed at the SHELL, not the engine** (the crux, 2b.4): the engine sees the registrant `email` as merely optional-at-key. `perRegistrant` ⇒ the shell re-imposes presence on *every* registrant email (everyone self-pays ⇒ everyone needs a receipt-capable email) — no blank-drop. `group` ⇒ the shell drops blank non-leader emails (→ absent → valid) and requires the *payer* email. Same shell-layer same-scope conjunction as `nonEmptyParty`; never touches the engine's activation limit.

**Test churn — budgeted HONESTLY (a shell/UI item, NOT a free toggle):**
- A **new action-level test through `parseSubmission`** (the real path, mirroring `action.test.ts:120-181`): a `group` submission with a blank non-leader `registrants[1].email` — rendered as `email: ''` — must SUCCEED (proving the shell blank-drop, not just the schema, works end-to-end). Without this test the relaxation looks done but fails on the real rendered payload.
- `decode.test.ts` standalone `email`-kind test (a required instance) is **unchanged**.
- **Email-required assertions flip** (~4-6 edits): "absent registrant email ⇒ required" → "absent ⇒ valid"; new: present-blank-via-shell-drop passes in group, group blank payer fails, perRegistrant any blank registrant email fails.
- **Render-parity pins (`registration-form.test.tsx`)**: the strict `toEqual` submit-name set must be extended with the new party names (`party.billingMode`, `party.payer.name`, `party.payer.email`), which live OUTSIDE the `registrants[0].` namespace. **And — the under-counted edit both reviews caught — a party SEED must be added** (the parity test renders the live form and checks every rendered field has a seed key; `makeDefaultRegistrant` has no party sibling today, `registration-form.tsx:127+`). So: ~2 set-extensions + 1 party-seed addition + the `RegistrationFormShape` lockstep (below). The relaxation is *additive but not zero-churn* — these are net-new render-wiring, not mechanical.
- **Mandatory client lockstep** (`registration-form.tsx:112-124`): adding `party` to the runtime shell REQUIRES adding it to the static `RegistrationFormShape` in the same commit, or the `as unknown as` cast silently hides the divergence and the render-parity pin breaks. `RegistrantInput.email` is already `Schema.optional(Schema.String)` (`:38`) — no change there.

**The relaxation is dormant until re-publish:** the edit lands in `defaults.ts` (the default), but the *published* `forms/registration.json` keeps the old required email field until re-authored. The relaxation takes effect on re-publish — the same shape as every CMS rollout (note it; not a bug).

#### 2b.4 — THE CRUX: handle at the route-owned party-aware shell decoder. Do NOT lift activation.

**Definitive verdict: keep activation same-scope-only (Decision 5 / Risk 5 untouched). The party→registrant email requirement is a bounded, closed law of the mode, handled in the route-owned shell decoder — NOT a lifted `activeWhenEquals` enclosing-scope DAG.** Both source designs and both reviews converge here; the argument:

**Why NOT lift:**
- `activeWhenEquals` (`definition.ts:285-293`, Decision 5) is an engine `CrossFieldRule` whose `when`/`target` are both `FieldName`s resolved within ONE `FieldList`; its integrity filter enforces same-scope (`:390-402`). Lifting "party-mode → registrant requiredness" means inventing a new addressing scheme where `when` references a non-`FieldList` location (the party section) — breaking the uniform `name→FieldKind` index the integrity filter, decoder (`decode.ts:464-478`), and renderer (`render.tsx:309-315`) all share. All three consumers would need a special enclosing-scope arm. That is exactly the general cross-scope DAG (with cycle detection across scope boundaries) the v1 limit defers.
- **The over-generalization argument is itself a `make-impossible-states-unrepresentable` argument** (and decisive): generalizing the engine's riskiest module to cross-scope to serve ONE closed fact makes a hundred unwanted cross-scope rules representable to serve the one wanted one.
- The party→registrant link is **not authored** — there is no CMS knob for "perRegistrant but emails optional." It is a fixed semantic of what `perRegistrant` *means*. So it does not belong in authored `rules` at all; it is a closed law in code, tested directly.

**Why the route-owned shell is correct (not a hack):** the shell is *already* the hand-authored boundary that owns party-level facts (`registration-action.ts:102-104`). The party section being first-class authored *content* (2b.1) doesn't change *where the submission is decoded* — content authored in CMS is still decoded at the route boundary the route owns. `mode` and `registrants` are siblings in the shell struct, so "require payer email when group / require each registrant email when perRegistrant" is a same-scope sibling check inside one struct — never the engine's cross-scope case.

**[MAJOR fix — the shell mechanics, fully specified, no undefined helpers]** Both reviews flagged that the source sketches leaned on undefined helpers (`buildModeUnion`, `requireRegistrantEmail`, `email`, `requiredString`, `FALLBACK`) and a private-to-`decode.ts` `email`/`requiredString`. Resolutions baked into the commit plan:
- **Export `email` and `requiredString` from `decode.ts`** (they are currently module-private, `decode.ts:114`). Named as an explicit edit in C7a (migrate-callers: the shell is the new caller).
- **The chosen-mode codec** reads `Object.keys(definition.party.billingMode.options)` as the allow-list (the authored struct keys): absent mode fills to the lone/first allowed via **`Schema.withDecodingDefaultKey(Effect.succeed(allowed[0]))`** (the real API — `toast.server.ts:17-25`, NOT `withDecodingDefault`; and it takes an `Effect.succeed(value)`, not a bare value); a *present* off-list `_tag` hard-rejects (the smuggle attack, tested). NOTE: `Schema.tag('group')` supplies only a *constructor* default, NOT a decode-time missing-key default — so `buildModeUnion` spells each arm's `_tag` as an explicit literal/tag schema piped through `withDecodingDefaultKey`, never relying on `Schema.tag` alone for the absent-mode fill.
- **`nonEmptyParty` is retained** (both designs let it slip into prose): `registrants.length > 0`, so `perRegistrant` cannot silently produce zero orders and `group`'s payer is never a phantom.

The bounded shell schema (route-owned, NOT the engine):

```ts
// app/lib/forms/registration-shell.ts (NEW) — replaces the inline struct at registration-action.ts:102-104
import { Schema } from 'effect';
import { definitionToSchema, email, requiredString } from './decode'; // email/requiredString now EXPORTED
import type { FormDefinition } from './definition';
import { BillingMode, type PartySection } from './party';

/** The nominated payer — decoded ONLY in the group arm (perRegistrant never reads it). */
const payerCodec = (party: PartySection) =>
  Schema.Struct({
    name: requiredString(party.payer!.nameField.requiredMessage),
    email: email(party.payer!.emailField.requiredMessage, party.payer!.emailField.invalidMessage),
  });

/** registrants.length > 0 — retained from the prior plan; perRegistrant never silently 0-orders. */
const nonEmptyParty = Schema.makeFilter(
  (shell: { readonly registrants: ReadonlyArray<unknown> }) =>
    shell.registrants.length > 0
      ? undefined
      : { path: ['registrants'], issue: 'registration.form.registrants.required' as const },
  { title: 'registrationShell.nonEmptyParty' },
);

/** perRegistrant re-imposes presence on EVERY registrant email — the one closed enclosing-scope law. */
const requireRegistrantEmails = (definition: FormDefinition) =>
  Schema.makeFilter(
    (shell: { readonly registrants: ReadonlyArray<Record<string, unknown>> }) => {
      for (let i = 0; i < shell.registrants.length; i += 1) {
        const e = shell.registrants[i]?.['email'];
        if (e === undefined || e === '')
          return { path: ['registrants', i, 'email'], issue: 'registration.form.email.required' as const };
      }
      return undefined;
    },
    { title: 'registrationShell.requireRegistrantEmails' },
  );

export const registrationShellSchema = (definition: FormDefinition) => {
  const party = definition.party;
  const registrant = definitionToSchema(definition);
  // options is a STRUCT { group?: Text, perRegistrant?: Text } — the authored keys ARE the allow-list.
  const allowed = party ? (Object.keys(party.billingMode.options) as BillingMode[]) : []; // e.g. ['group'] or ['group','perRegistrant']

  // No party section (legacy/contact/volunteer) ⇒ the today shell, group-implicit.
  if (party === undefined || allowed.length === 0)
    return Schema.Struct({
      registrants: Schema.mutable(Schema.Array(registrant)),
    }).check(nonEmptyParty as never);

  const groupShell = Schema.Struct({
    party: Schema.Struct({ _tag: Schema.tag('group'), payer: payerCodec(party) }),
    registrants: Schema.mutable(Schema.Array(registrant)),   // emails optional; shell drops blank '' (2b.3)
  }).check(nonEmptyParty as never);

  const perRegistrantShell = Schema.Struct({
    party: Schema.Struct({ _tag: Schema.tag('perRegistrant') }),  // no payer — unrepresentable
    registrants: Schema.mutable(Schema.Array(registrant)),
  }).check(nonEmptyParty as never).check(requireRegistrantEmails(definition) as never);

  // Union ONLY the authored arms (allow-list enforcement); a single-mode form is one arm.
  // The absent-mode default is applied to the DISCRIMINANT inside buildModeUnion:
  //   Schema.optionalKey(Schema.Literals(allowed)).pipe(Schema.withDecodingDefaultKey(Effect.succeed(allowed[0])))
  // (Schema.tag above gives only a constructor default — the decode-time fill is the
  // withDecodingDefaultKey on the discriminant.) Present off-list _tag ⇒ hard-reject (smuggle test).
  return buildModeUnion(allowed, { group: groupShell, perRegistrant: perRegistrantShell });
};
```

(`buildModeUnion` is a small, named local — `Schema.Union` of the authored arms, discriminated on `party._tag`, with the absent-mode default applied; C7.5 includes a decode test for "absent mode on a 2-mode form decodes to the first authored arm with its requirements intact.")

The three derivations (2b.6) all fall out of the ONE decoded `party._tag`.

#### 2b.5 — CMS authoring + localization: no route-static copy survives (blockers fixed)

Every party string is authored content, but with two correctness fixes the source designs got wrong:

**[BLOCKER fix — model mode options as a STRUCT of optionalKey known modes (not an array, NOT a Record)]** Both source designs claimed `party.billingMode.options.<value>.label.en` rides the same identity-keyed `deepMerge` as `team.<id>`. **It does not** — `itemIdentity` (`admin-form.ts:152-156`) keys on `id`/`slug` only, and a `{value,label}` item carries neither, so `deepMerge` returns such array items untouched and **silently drops the label edit** (`:414-416`). The intuitive fix (`Schema.Record(BillingMode, Text)`) is ALSO wrong: a `Record` over `Schema.Literals` **requires all literal keys** in effect beta.60 (verified — a group-only object REJECTS), so it cannot model an allow-list. **Correct shape: a `Schema.Struct({ group: optionalKey(Text), perRegistrant: optionalKey(Text) }).check(nonEmptyOptions)`** — an ABSENT key means that mode is not offered (the allow-list), and the value is `Text` directly so the edit path is `party.billingMode.options.group.en` (NOT `...options.group.label.en`). A keyed object struct merges natively through `setPath`'s object-tree merge (`admin-form.ts:169-187`) + `deepMerge`'s object branch, **zero array-identity step, zero `itemIdentity` change**. `nonEmptyOptions` rejects the zero-mode case. **Proven in `app/lib/forms/party-scope-spike.test.ts`** (struct edit lands + siblings survive; group-only merges with no phantom `perRegistrant`; the array shape drops the edit).

**[BLOCKER fix — honest MessageKey-deploy statement]** Labels (`Text`, the bilingual `{en,fr}` halves) are fully CMS-authorable post-deploy via `deepMerge`. But the party's `MessageKey` leaves (`billingMode.requiredMessage`, `payer.*.requiredMessage`, `payer.emailField.invalidMessage`) validate against the **static** `TRANSLATION_KEYS` set (`definition.ts:52`). So a brand-new `registration.party.*` token **cannot** be introduced by a CMS edit — it must ship in `app/lib/localization/translations.ts` source first (a deploy), after which its en/fr *strings* are CMS-editable via the `t:<locale>:<key>` channel (`admin-form.ts:112-141`), exactly like every existing form message. **The honest statement, stated in the plan and not papered over:** *new message-key tokens ship in `translations.ts` in C7a (a one-time deploy); thereafter their en/fr strings, and ALL labels, are CMS-editable with no deploy.* This is the same constraint every existing form field lives under — and is strictly more honest than the prior plan's route-static-JSX mode copy (which required a deploy for *every* copy change).

| copy | authored as | edit path |
|---|---|---|
| mode selector legend | `party.billingMode.label: Text` | `party.billingMode.label.en/.fr` (deepMerge, no deploy) |
| each mode's radio label | `party.billingMode.options: Struct({ group?: Text, perRegistrant?: Text })` | `party.billingMode.options.group.en` (deepMerge object-tree, no deploy) |
| mode required/smuggle message | `party.billingMode.requiredMessage: MessageKey` | token ships in C7a (deploy); string via `t:` channel |
| payer block + name/email labels | `party.payer.{label, nameField.label, emailField.label}: Text` | deepMerge, no deploy |
| payer name/email messages | `party.payer.*.{requiredMessage, invalidMessage}: MessageKey` | token ships in C7a (deploy); string via `t:` channel |

**No route-static labels survive:** the mode selector + payer inputs render from `definition.party.*` `Text` (`field.label[locale]`, the same idiom `<FormFields>` uses for engine fields, `registration-form.tsx:97-103`), never from `translate('registration.form.attendee')` route-static keys. **Acknowledged inconsistency (both reviews):** the adjacent *existing* attendee/exhibitor radios still render via route-static `translate(...)` keys (`registration-form.tsx:292-326`); converting them is out of scope, so the new party radio renders in a *different* (CMS `Text`) idiom than its neighbors. Noted, not blocking — the party radio is the one Constraint 4 governs.

#### 2b.6 — The THREE orthogonal consequences, re-confirmed under the payer model

All three derive from the single decoded `party._tag` (`derive-dont-sync` preserved). The only deltas from the prior (pre-party-scope) table are (i)/(iii)'s `group` source: `registrants[0].email` → `party.payer.email`.

| consequence | reads | derivation | layer |
|---|---|---|---|
| **(i) email-required** | `party._tag` | `group` ⇒ **payer** email required (shell), registrant emails optional; `perRegistrant` ⇒ every **registrant** email required (shell `requireRegistrantEmails`) | shell decode (2b.4) |
| **(ii) payment cardinality** | `party._tag` as loop count | `group` ⇒ 1 `priceGroup` order/intent; `perRegistrant` ⇒ N `priceRegistrant` orders/intents | C7/C7.5 |
| **(iii) receipt routing** | `party._tag` + the frozen email *value* | `group` ⇒ `receipt_email = party.payer.email`; `perRegistrant` ⇒ intent_i `receipt_email = registrants[i].email` | create-intent, frozen onto `RegistrationOrder.receiptEmail` |

`price()` stays oblivious to receipt routing (email is a `createIntent` param, invisible to `priceRegistrant`/`priceGroup`). `RegistrationOrder.receiptEmail` stays a required frozen `Schema.String` (every order written with it — never `optionalKey`, guarding the backfill hazard).

**Idempotency-fingerprint note (both reviews flagged the regression to silence):** `party.payer.email` is a new submitted field, so it enters `JSON.stringify(submission.payload)` → the request fingerprint (`registration-action.ts:125`). This is *fine* — a verbatim retry is the same payload ⇒ same fingerprint ⇒ same idempotency key ⇒ Stripe replays the first intent. The freeze discipline is unchanged; the fingerprint surface merely grew by the payer fields. Stated so it is not an unexamined gap.

#### Final effect-v4 schemas

```ts
// app/lib/forms/party.ts (NEW) — a top-level authored SECTION on FormDefinition, NOT a FieldKind.
import { Schema } from 'effect';
import { Text } from '../content/schema';
import { MessageKey } from './definition';

/** The closed billing-mode token set. ONE definition; reused by the shell codec + PaymentState. */
export const BillingMode = Schema.Literals(['group', 'perRegistrant']);
export type BillingMode = typeof BillingMode.Type;

/**
 * The party-level mode selector. Options are a STRUCT of optionalKey known modes
 * (NOT Schema.Record(BillingMode, Text) — verified: a Record over Schema.Literals
 * REQUIRES all literal keys in effect beta.60, so it cannot model a group-only
 * allow-list; and NOT an array — itemIdentity keys on id/slug only, admin-form.ts:
 * 152-156, so an array of {value,label} silently drops label edits). A keyed
 * object struct merges natively through deepMerge's object branch; an ABSENT key
 * means that mode is not offered (the allow-list). The value is `Text` directly,
 * so the authoring/edit path is `party.billingMode.options.group.en` (NOT
 * `...options.group.label.en`). `nonEmptyOptions` rejects the zero-mode case.
 * Proven in app/lib/forms/party-scope-spike.test.ts.
 */
const BillingModeSelector = Schema.Struct({
  label: Text,                                  // the radio-group legend (CMS Text, no deploy)
  requiredMessage: MessageKey,                  // emitted on an off-list/smuggled mode (token ships in C7a)
  options: Schema.Struct({                      // allow-list: absent key ⇒ mode not offered
    group: Schema.optionalKey(Text),
    perRegistrant: Schema.optionalKey(Text),
  }).check(nonEmptyOptions),                    // ≥1 mode authored (mirror nonEmptyOptions, definition.ts:111-117)
});

/**
 * The nominated payer's authored chrome — labels + message keys for a name+email
 * contact. A fixed sub-struct (NOT an open FieldList): a payer is exactly an
 * addressable receipt recipient (make-impossible-states-unrepresentable).
 */
const PayerFields = Schema.Struct({
  label: Text,                                  // block heading ("Who is paying?")
  nameField: Schema.Struct({ label: Text, requiredMessage: MessageKey }),
  emailField: Schema.Struct({ label: Text, requiredMessage: MessageKey, invalidMessage: MessageKey }),
});
export type PayerFields = typeof PayerFields.Type;

/**
 * The CMS-authored PARTY SECTION — a sibling of fields/variant/rules (optionalKey,
 * backfill-safe). Present ⇒ multi-party (registration); absent ⇒ single-submission
 * (contact/volunteer). `payer` is optionalKey; the FormDefinition integrity filter
 * enforces: 'group' ∈ options KEYS ⟺ payer present (no dead/meaningless authored payer).
 */
export const PartySection = Schema.Struct({
  intro: Schema.optionalKey(Text),
  billingMode: BillingModeSelector,
  payer: Schema.optionalKey(PayerFields),
});
export type PartySection = typeof PartySection.Type;

// definition.ts — FormDefinition gains ONE optionalKey sibling (mirrors variant/rules :516-517):
//   party: Schema.optionalKey(PartySection),
// + the integrity arm folded into the combined FormDefinition.check (added in C4a):
//   'group' ∈ Object.keys(party.billingMode.options)  ⟺  party.payer !== undefined
```

`PaymentState.mode` / `RegistrationOrder.receiptEmail` schemas are unchanged from their schemas above; `receiptEmail`'s group source is now `party.payer.email`.

---

### Decision 3 — `pricing` on `FormDefinition`: **`optionalKey` (absence ⇒ unpriced), NOT required-plus-backfill**

**Chosen:** `pricing: Schema.optionalKey(PricingRules)` on `FormDefinition` (`:512`); absence is
the canonical "unpriced" state, read directly by `price()`.
**Rejected:** Codex's required `pricing` field + a `normalizeFormDefinition` backfill.
**Rationale:** a required field on an already-published `forms/{contact,volunteer,registration}.json`
(all three decode through the same `FormDefinition`, `registry.ts:229-233`) **fails decode** if
absent — the recurring backfill hazard (`registrar-context.md:64-72`). Both `variant` and `rules`
are *already* `optionalKey` (`definition.ts:516-517`); pricing follows the same precedent.
`optionalKey` *removes* the hazard rather than papering it with a `normalize` hook that becomes
load-bearing and breaks any decode path that bypasses it (a test fixture, a future direct decode).
The Codex review verified that Codex's `normalize`-through-`ObjectSpec.normalize` *would* cover
both reads (public `content.server.ts:593`, admin draft `draft-editor.server.ts:374-379`) — but
both reviews concur `optionalKey` is the safer call. **No `FORM_SPECS.normalize` is needed for the
pricing key.** (The submission-`payment` backfill is a separate, latent concern — see Risks.)

### Decision 4 — `price()` signature + `contributionOf` per decoded kind (resolves BLOCKER B3)

`DecodedForm = Record<string, unknown>` (`decode.ts:57`) is untyped, so `contributionOf` must
**narrow defensively per `PricingRule` kind against the actual decoded runtime values** — verified
against `decode.ts`'s leaf codecs:

| `PricingRule` kind | targets `FieldKind` | decoded runtime value | `contributionOf` |
|---|---|---|---|
| `choice` | `literal` | a branded `OptionValue` **string** (`literal` → `Schema.Literals`, decode.ts:135-141) | `prices.find(p => p.option === value)?.amount ?? 0` |
| `multiChoice` | `arrayOfLiteral` | a mutable **array of `OptionValue` strings** (decode.ts:160-170) | `Σ over selected: prices.find(p => p.option === el)?.amount ?? 0` |
| `toggle` | `checkboxBoolean` | a real **`boolean`** (the `true/false/on` codec transforms to `value !== 'false'`, decode.ts:148-157) — **never `'on'`/`'true'` at the decoded layer** | `value === true ? amount : 0` |
| `quantity` | `number` (new kind, Decision-note) | a **non-negative integer** (`Schema.Int`) | `clamp(value, 0, max) * unit` |

```ts
// app/lib/forms/price.ts  (NEW) — PURE: no Effect, no Date.now(), no Clock
export const priceRegistrant = (
  definition: FormDefinition,
  decoded: DecodedForm,       // ONE registrant (the route owns the array shell)
  nowMillis: number,          // injected — server passes Clock.currentTimeMillis, client Date.now()
): Cents => {
  const p = definition.pricing;
  if (p === undefined) return Cents.make(0);
  const index = activationIndex(definition);                 // Decision 5
  let total = p.base as number;
  for (const rule of p.rules) {
    total += isActiveByName(rule.field, index, decoded)       // inactive ⇒ contributes 0
      ? contributionOf(rule, decoded)
      : 0;
  }
  total += windowDelta(p.windows ?? [], nowMillis);           // Decision 6
  return Cents.make(Math.max(0, total));                       // runtime clamp — never negative
};

/** The group total: sum each registrant's price (Decision 2). */
export const priceGroup = (
  definition: FormDefinition,
  registrants: ReadonlyArray<DecodedForm>,
  nowMillis: number,
): Cents =>
  Cents.make(registrants.reduce((sum, r) => sum + (priceRegistrant(definition, r, nowMillis) as number), 0));
```

Both reviews flagged the untyped-`DecodedForm` access (B3); the table above is the explicit
narrowing contract, **with a test per kind** (C3). The branded `OptionValue` compares cleanly
against the rule's `option` field (both are `OptionValue` post-decode); `contributionOf` reads the
decoded value, never the raw POST string.

### Decision 5 — Conditional/dependent fields: **`activeWhenEquals` as a new `CrossFieldRule` member (Claude's design), widened with Codex's richer predicate union, ONE shared `isActive`**

This reconciles the two conditional-field designs. **Take Claude's structural home** (a new
`CrossFieldRule` member, keyed by `target`) over Codex's per-field `activeWhen` on field chrome,
**because**:
- The closed `CrossFieldRule` union (`definition.ts:490`) is *already* the home for "validity no
  single-field check can express," is *already* indexed by the renderer keyed by `target`
  (`render.tsx:309-315`), and *already* has a presence-filter accumulator (`decode.ts:464-478`).
  A per-field `activeWhen` would widen **all eight `FieldKind` members** plus the hand-written
  recursive `FieldKindShape` mirror type (`definition.ts:136-183`) that must move in lockstep with
  the `Schema.TaggedUnion` or `Schema.suspend` breaks — exactly the "widens every kind" cost the
  context warns against (`registrar-context.md:107`). A rule keeps the field kinds **untouched**
  (`subtract-before-you-add`).
- It mirrors `requiredWhenEquals` member-for-member, so the integrity filter, the decoder index,
  and the renderer index are **one** pattern.

**But take Codex's richer predicate union** (not just literal-equals): activation must cover
checkbox and array triggers (`registrar-context.md` implies "when 'addBanquet' == 'yes'" and
multi-select gates). So the new rule carries a **closed tagged `ActiveWhen` predicate**, not a
bare `equals`:

```ts
// definition.ts — NEW member on CrossFieldRule (the union at :490)
const nonEmptyActivationValues = Schema.makeFilter<ReadonlyArray<unknown>>(
  (values) => (values.length > 0 ? undefined : 'activeWhen must name at least one trigger value'),
  { title: 'ActiveWhen.values' },
);

export const ActiveWhen = Schema.TaggedUnion({
  literalEquals:   { when: FieldName, equals: Schema.Array(OptionValue).check(nonEmptyActivationValues) },
  arrayIncludesAny:{ when: FieldName, values: Schema.Array(OptionValue).check(nonEmptyActivationValues) },
  checkboxChecked: { when: FieldName },
});
export type ActiveWhen = typeof ActiveWhen.Type;

export const CrossFieldRule = Schema.TaggedUnion({
  requiredWhenEquals: {                  // unchanged
    when: FieldName, equals: Schema.Array(OptionValue).check(nonEmptyEquals),
    target: FieldName, message: MessageKey,
  },
  // NEW — activation. `target` is ACTIVE only when `predicate` holds over a sibling.
  // No `message`: activation has no failure of its own — it GATES other checks.
  activeWhenEquals: { predicate: ActiveWhen, target: FieldName },
});
```

**The orthogonality (the context's load-bearing clarification, `registrar-context.md:177-209`)** —
THREE independent axes keyed by field, never conflated:

| axis | what it does | source | derivable from? |
|---|---|---|---|
| **(a) activation** | gates render (hide) + presence (don't require) + price-eligibility | `activeWhenEquals` rule (absent ⇒ always-active) | independent |
| **(b) required-ness** | whether an *active* field must be present | the field's own kind + any `requiredWhenEquals` | MAY derive from activation (a hidden field is not required) but a present active field's requirement is its own |
| **(c) pricing** | whether an *active* field contributes | a `PricingRule` keyed to it (absent ⇒ contributes 0) | independent — never inferred from required-ness or activation |

**Price-eligibility = `isActive(field) ∧ ∃ pricingRule(field)`** — two independent predicates AND-ed.
All four combos are representable: active∧required∧priced, active∧required∧unpriced,
active∧optional∧priced, active∧optional∧unpriced. An active field with no rule contributes 0; an
inactive field contributes 0 regardless of any rule.

**ONE shared pure `isActive`** in a new `app/lib/forms/activation.ts`, consumed by all three —
never reimplemented (`derive-dont-sync`):

```ts
// activation.ts — PURE, value-only (no Clock; activation depends only on chosen values)
export type ActivationScope = Readonly<Record<string, unknown>>;

const predicateHolds = (predicate: ActiveWhen, scope: ActivationScope): boolean => {
  const value = scope[predicate.when];
  switch (predicate._tag) {
    case 'literalEquals':
      return typeof value === 'string' && predicate.equals.includes(value as never);
    case 'arrayIncludesAny':
      return Array.isArray(value)
        && value.some((el) => typeof el === 'string' && predicate.values.includes(el as never));
    case 'checkboxChecked':
      return value === true;   // checkboxBoolean decodes to a real boolean (decode.ts:148-157)
  }
};

/** Index activation rules by target (one per target, enforced at decode). */
export const activationIndex = (definition: FormDefinition):
  ReadonlyMap<string, Extract<CrossFieldRule, { _tag: 'activeWhenEquals' }>> => {
  const map = new Map<string, Extract<CrossFieldRule, { _tag: 'activeWhenEquals' }>>();
  for (const rule of definition.rules ?? []) {
    if (rule._tag === 'activeWhenEquals') map.set(rule.target, rule);
  }
  return map;
};

/** THE shared evaluator. No rule ⇒ always active. Same-scope sibling lookup (v1). */
export const isActiveByName = (
  fieldName: string,
  index: ReadonlyMap<string, Extract<CrossFieldRule, { _tag: 'activeWhenEquals' }>>,
  scope: ActivationScope,
): boolean => {
  const rule = index.get(fieldName);
  return rule === undefined ? true : predicateHolds(rule.predicate, scope);
};
```

The **three consumers**:
- **price** (`contributionOf` guard, Decision 4) — inactive ⇒ contributes 0.
- **decode** (`makePresenceFilter`, `decode.ts:464-478`) — the four decode rows (next paragraph),
  slotted into the *single* accumulating filter so issues co-surface.
- **render** (`render.tsx`) — **retire the renderer's current use of `requiredWhenEquals` AS a
  visibility gate.** Today `RuleGatedField` (render.tsx:157-176) derives visibility from
  `requiredWhenEquals` (confirmed: `active = rule.equals.includes(value)` at `:173-174`). That
  conflates presence-requirement with visibility. After this change, **`requiredWhenEquals` is
  presence-only** and **`activeWhenEquals` drives visibility**, both feeding the same gate
  component via `isActive`. The existing contact/volunteer `method`-gated email/phone migrates from
  a `requiredWhenEquals`-as-visibility to an explicit `activeWhenEquals` (+ a `requiredWhenEquals`
  for the "if shown, must be non-empty" half) — a behavior-preserving migration proven by the
  existing render tests.

**Decode semantics** (the four rows where wrong totals hide — `registrar-context.md:163-164`).
Let `A` carry `activeWhenEquals(predicate, target=A)`; `active = predicateHolds(predicate, decoded)`
over the **decoded sibling values**. `A`'s struct entry is modelled `optionalKey` (so inactive
absence decodes), the activation guard then re-imposes presence when active:

| submission | active | semantics | mechanism |
|---|---|---|---|
| `A` absent | false | **valid** — no requirement, no price | `optionalKey` entry; presence filter skips |
| `A` present | false | **REJECT — out-of-form payload** | push issue at `[A]` when `decoded[A] !== undefined && !active` (mirrors the engine's `extra.other`-absent reject, decode.ts:104-108) — a smuggled value NEVER reaches `price()` |
| `A` absent | true | **REJECT — required** | push `A`'s own kind `requiredMessage` at `[A]` (mirrors `rulePresenceIssue`, decode.ts:448-450) |
| `A` present | true | **valid iff `A`'s kind codec passes** | runs `fieldToRequiredSchema(A)` (decode.ts:179-204) normally |

**Scope (v1): same-scope sibling only.** `predicate.when` references an earlier sibling in the
same `FieldList` (top-level, same `nestedGroup.fields`, or same `FormVariant.fields`). The
integrity filter (below) enforces it locally. Enclosing-scope references (a group field gated on a
top-level discriminator), cross-branch references, and chained/cyclic activation are **deferred**
(documented follow-ups, `registrar-context.md:170-171`); the integrity filter rejects a cycle in
v1 (cheap same-filter check).

**Decode-time reference-integrity filter** — covers BOTH rule kinds (closes the pre-existing
`requiredWhenEquals` integrity gap too), attached to `FormDefinition` (which has no `.check`
today, `definition.ts:512`), mirroring `variantsMatchOptions`:

```ts
// definition.ts — struct-level on FormDefinition, walking fields + variant + rules
const rulesReferToExistingFields = Schema.makeFilter<FormDefinition['Encoded']>(
  (def) => {
    // build name→FieldKind and literal/array name→Set<optionValue> over fields + variant branches
    // for each rule (both kinds):
    //   - `when` names an existing field IN THE SAME SCOPE as `target`
    //   - literalEquals ⇒ `when` is a `literal`; every `equals` ∈ when.options
    //   - arrayIncludesAny ⇒ `when` is an `arrayOfLiteral`; every `values` ∈ when.options
    //   - checkboxChecked ⇒ `when` is a `checkboxBoolean`
    //   - `target` names an existing field in scope, target !== when, no cycle
    return undefined; // or a precise message
  },
  { title: 'FormDefinition.rulesReferToExistingFields' },
);
// FormDefinition = Schema.Struct({...}).check(rulesReferToExistingFields)
```

### Decision 6 — Timing: **additive signed deltas over non-overlapping windows, server `Clock`, half-open UTC windows, first-match**

**Chosen:** `base + Σ(active priced choices) + windowDelta` where `windowDelta` is a signed delta
(early-bird negative, late positive) from the **first window whose `[from, to)` half-open UTC range
contains `now`**; windows are decode-time **non-overlapping** so first-match is total and
order-independent.
**Rejected:** tiered-base override (each window a distinct base that re-tiers every surcharge).
**Rationale:** additive keeps choices orthogonal to timing (`subtract-before-you-add`) — a tiered
base forces re-stating every choice surcharge per tier. Both plans independently chose additive
signed deltas. **Half-open `[from, to)`** (Codex) over inclusive-both (Claude): half-open composes
cleanly at window boundaries with no double-counting (a `to` that equals the next `from` belongs to
exactly one window). The **non-overlap decode filter** makes overlapping windows unrepresentable, so
"first wins" can never silently hide a second applicable discount. Server evaluates
`now = yield* Clock.currentTimeMillis` (verified usage at `submissions.server.ts:118`); the pure
`windowDelta(windows, nowMillis)` takes the millis so `TestClock` pins it deterministically.

```ts
// pricing.ts
export const TimingWindow = Schema.Struct({
  id: ListItemId,          // stable identity for admin edits (ADR 0006, schema.ts:220)
  label: Text,
  from: IsoDate,           // inclusive start (00:00:00 UTC)
  to: IsoDate,             // EXCLUSIVE end (00:00:00 UTC of `to`) — half-open [from, to)
  delta: CentsDelta,       // signed: early-bird negative, late positive
}).check(orderedWindowFilter);   // from < to, mirrors orderedDateRangeFilter (schema.ts:338)
```

# Amendments to Decision 7 (order-of-ops)

The Decision 7 sequence (Decision 7 above) is amended at three slots; the rest stands verbatim.

- **Step 0 (decode the shell)** — now decodes via `registrationShellSchema(definition)` (2b.4), which (a) validates the chosen `party._tag` against the authored `party.billingMode.options` allow-list (absent ⇒ lone/first via `withDecodingDefaultKey`; present off-list ⇒ hard-reject — the smuggle test), (b) decodes the **`group`-arm `payer` (name + required email)**, (c) leaves registrant emails optional in `group` and **re-imposes every registrant email in `perRegistrant`** (`requireRegistrantEmails`), (d) guarantees `nonEmptyParty`. A decode failure returns `formValidationError` as today — no new pass. For a legacy/no-`party` definition the shell is the today `{registrants}` struct, group-implicit.

- **Step 3 (persist the order record + freeze `receiptEmail`)** — `group` ⇒ `receiptEmail = decoded.party.payer.email` (the nominated payer, possibly a non-attendee); `perRegistrant` ⇒ order_i `receiptEmail = registrants[i].email`. The payer block is consulted ONLY in the `group` arm (structurally absent in `perRegistrant`).

- **Step 4 (create intents)** — `receipt_email` is read from the **frozen** `order.receiptEmail`, never re-read from form data. Idempotency keys unchanged (`registration:checkout:${requestFingerprint}:${mode}` / `…:perRegistrant:${index}`). The payer fields are now part of the fingerprinted payload (retry-stable; see 2b.6 note).

Branch on `decoded.party._tag` (the single discriminant) at steps 2/3/4 for cardinality + receipt routing.

---

### Decision 8 — Feature flag = `Env.stripe` `None`-gate (resolves BLOCKER B1)

**Chosen:** the registrar is gated by `Env.stripe` being `Some` (both `STRIPE_API_KEY` and
`STRIPE_WEBHOOK_SECRET` non-blank), optionally AND a `REGISTRAR_CHECKOUT_ENABLED` env var for an
explicit kill-switch. `None` ⇒ the registration action skips payment and behaves exactly as today
(RegFox-era), and the webhook route 503s.
**Rejected (BLOCKER B1):** Claude's "ship behind an `enabled: false` registration page." **There is
no `'registration'` `PageId`** — `PageId` is `about/faq/give/contact/volunteer/archive/home/team`
(`registry.ts:74-83`); `registration` is a `FormId` (`:94`), and `FormDefinition` has **no
`enabled` field** (`:512-518`). The per-page `enabled` flag (Feature C) is on **Pages only**. The
registration route is `($lang)+/2026/form/route.tsx`, not a page object. The `Env.stripe` `None`-gate
is the *real* flag, and it's the house pattern (mirrors `sendgridConfig`).

**Smallest first slice → larger slices:**
- **Slice 1 (C1–C3): pure pricing, zero Stripe** — money brands + `PricingRules` + integrity
  filter + pure `price()`/timing. Fully testable, no network/secrets, back-compat-safe (`optionalKey`).
- **Slice 2 (C4a–C4c): conditional/dependent fields** — activation model + integrity filter +
  shared `isActive` + decode/render/price wiring. No Stripe.
- **Slice 3 (C5–C8): party scope + Stripe** — env+dep (C5), Payment service (C6), party section
  schema + integrity filter (C6.5), registrant email relaxation + party MessageKey tokens (C7a),
  party-aware shell decode + group checkout with frozen payer `receiptEmail` (C7), perRegistrant
  fan-out + per-registrant email re-imposition + allow-list + receipt fan-out (C7.5), webhook (C8).
  Build order: C5 → C6 → C6.5 → C7a → C7 → C7.5 → C8 (C6.5 needs C4a's combined `FormDefinition.check`).
- **Slice 4 (C9): quantity kind + CMS authoring** (extends the party authoring inputs — every party
  leaf is a string, no new leaf-coercion).

### The final effect-v4 schemas

```ts
// app/lib/forms/pricing.ts  (NEW)
import { Schema } from 'effect';
import { Text, IsoDate, ListItemId } from '../content/schema';
import { FieldName, OptionValue } from './definition';

/** Minor units (cents). Int rejects NaN/Inf/float; >=0 forbids negative cents. */
export const Cents = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('Cents'));
export type Cents = typeof Cents.Type;

/** A signed delta in cents — a discount window is negative, a surcharge positive. */
export const CentsDelta = Schema.Int.pipe(Schema.brand('CentsDelta'));
export type CentsDelta = typeof CentsDelta.Type;

/** ISO currency token; one currency per form (CAD for GYC). Closed literal — no silent mismatch. */
export const CurrencyCode = Schema.Literals(['cad']).pipe(Schema.brand('CurrencyCode'));
export type CurrencyCode = typeof CurrencyCode.Type;

const OptionPrice = Schema.Struct({ option: OptionValue, amount: Cents });

export const PricingRule = Schema.TaggedUnion({
  choice:      { field: FieldName, prices: Schema.Array(OptionPrice) }, // literal — selected option adds
  multiChoice: { field: FieldName, prices: Schema.Array(OptionPrice) }, // arrayOfLiteral — each adds
  toggle:      { field: FieldName, amount: Cents },                     // checkboxBoolean — true adds
  quantity:    { field: FieldName, unit: Cents, max: Schema.Int },      // number kind (C9) — unit*qty
});
export type PricingRule = typeof PricingRule.Type;

export const PricingRules = Schema.Struct({
  currency: CurrencyCode,                                  // form-level, one currency
  base: Cents,                                             // form-level base fee
  rules: Schema.Array(PricingRule),
  windows: Schema.optionalKey(Schema.Array(TimingWindow)),
  // NOTE: billing-mode selection moved OUT of PricingRules into the authored `party` section
  // on FormDefinition (Decision 2b — `party.billingMode.options`). PricingRules no longer
  // carries `billingModes`.
  // registration deadline (Q4) — after this UTC date a still-`pending` order is swept to
  // `expired` (retained, never deleted — feeds the follow-up-email workflow). Absent ⇒
  // no deadline (pending stays indefinitely, current behaviour).
  registrationDeadline: Schema.optionalKey(IsoDate),
});
export type PricingRules = typeof PricingRules.Type;
```

```ts
// app/lib/forms/submission.ts — PaymentState on the submission envelope (optionalKey)
const BillingMode = Schema.Literals(['group', 'perRegistrant']);

export const PaymentState = Schema.TaggedUnion({
  unpriced: {},                                                          // contact/volunteer
  pending:  { orderId: Schema.String, mode: BillingMode, amount: Cents, currency: CurrencyCode },
  paid:     { orderId: Schema.String, mode: BillingMode, amount: Cents, currency: CurrencyCode, paidAt: IsoDate },
  failed:   { orderId: Schema.String, mode: BillingMode, reason: Schema.String },
  expired:  { orderId: Schema.String, mode: BillingMode, amount: Cents, currency: CurrencyCode }, // swept past deadline (Q4) — retained
});
export type PaymentState = typeof PaymentState.Type;

// app/lib/forms/order.ts (NEW) — the group/order record (Decision 2)
// For billingMode 'group' there is ONE order keyed by requestFingerprint; for
// 'perRegistrant' there is one order per registrant keyed `${requestFingerprint}:${index}`.
export const RegistrationOrder = Schema.Struct({
  orderId: Schema.String,                                  // group: fingerprint; perRegistrant: fingerprint:index
  intentId: Schema.String,
  amount: Cents,                                           // FROZEN at create-intent time
  currency: CurrencyCode,
  receiptEmail: Schema.String,                            // FROZEN — group: party.payer.email (nominated); perRegistrant: registrants[i].email (Decision 2b)
  status: Schema.Literals(['pending', 'paid', 'failed', 'expired']),
  registrantIds: Schema.Array(ListItemId),                // group: all party ids; perRegistrant: the one id
  deadline: Schema.optionalKey(IsoDate),                  // copied from pricing.registrationDeadline at create (Q4)
});
```

**Orthogonality table (active × {required, optional} × {priced, unpriced}) — all four representable:**

| activation | required-ness | pricing | example |
|---|---|---|---|
| active | required | priced | a mandatory paid add-on shown only for attendees |
| active | required | unpriced | a mandatory free question (always shown) |
| active | optional | priced | an opt-in surcharge (`addBanquet` checkbox, +$X) |
| active | optional | unpriced | a free optional question |
| inactive | — | — | contributes 0, hidden, not required (regardless of any pricing rule) |

---

## 2. Commit-broken plan

> Gate per commit: `bun test` + (`react-router typegen && tsgo --noEmit`) + `oxlint`. Each commit
> compiles and gates green standalone — "how" stated per commit.

### C1 — `feat(forms): Cents/CentsDelta/CurrencyCode money brands + PricingRule/PricingRules schema`

**Files:** NEW `app/lib/forms/pricing.ts` (`Cents`, `CentsDelta`, `CurrencyCode` brands;
`OptionPrice`, `PricingRule` `TaggedUnion` over `choice`/`multiChoice`/`toggle` — **no `quantity`,
no `windows` yet**; `PricingRules` struct with `currency`/`base`/`rules`). NEW
`app/lib/forms/pricing.test.ts`.
**Shape:** as the schema block above (minus quantity/windows). Brands built
`Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('Cents'))` — mirrors
`BibleRef`'s `Schema.Int.check(...)` at `content/schema.ts:373`; `CurrencyCode` mirrors `Schema.Literals`.
**Gate-green:** no consumers yet → compiles in isolation. Tests: round-trip `encode→JSON→decode`;
`Cents` rejects negative/float/NaN; `CurrencyCode` rejects non-`cad`; `PricingRule` tag closure.
**Deps:** none (imports `FieldName`/`OptionValue` from `definition.ts`, `Text` from `content/schema`).

### C2 — `feat(forms): TimingWindow + ordered/non-overlap filters + wire pricing onto FormDefinition`

**Files:** EDIT `app/lib/forms/pricing.ts` (add `TimingWindow` with `id: ListItemId`,
`from`/`to: IsoDate`, `delta: CentsDelta`; `orderedWindowFilter` mirroring `orderedDateRangeFilter`
`schema.ts:338`; `nonOverlappingWindowsFilter`; add `windows?` to `PricingRules`). EDIT
`app/lib/forms/definition.ts` (add `pricing: Schema.optionalKey(PricingRules)` to `FormDefinition`
`:512`; add a `pricingReferencesResolve` struct-level filter walking `pricing.rules` against
`fields`+`variant` field/option sets, mirroring `variantsMatchOptions` `:402-432`; attach via
`.check`). EDIT `pricing.test.ts` + `definition.test.ts`.
**Gate-green:** `optionalKey` ⇒ every existing `forms/*.json` decodes unchanged (back-compat test).
Tests: window ordering/overlap rejection; a pricing rule naming a missing field/option fails
decode (the proof that "separate structure" honors `derive-dont-sync` at the boundary); existing
no-pricing definition still decodes.
**Deps:** C1.

### C3 — `feat(forms): pure priceRegistrant/priceGroup total evaluator`

**Files:** NEW `app/lib/forms/price.ts` (`priceRegistrant`, `priceGroup`, `contributionOf`,
`windowDelta` — pure, no Effect/`Date.now()`; `windowDelta` half-open UTC widening via a local
`toExclusiveEndMs`/`toStartMs`). NEW `app/lib/forms/price.test.ts`.
**Shape:** Decision 4 sketch. `contributionOf` narrows per kind per the Decision-4 table — **one
test per kind** (choice / multiChoice / toggle). The activation guard call (`isActiveByName`) is
introduced here as a no-op-when-no-rules pass-through and *exercised* in C4c.
**Gate-green:** smallest correct first slice — zero Stripe, fully unit-testable. Tests: base only;
base+choice; base+toggle on/off; base+multiChoice (multiple selected); early-bird window at a `now`
inside (applied) and outside (not applied); half-open boundary (a `now == to` excluded); clamp at 0
for a discount exceeding base; unpriced (no `pricing`) → 0; `priceGroup` sums two registrants.
**Deps:** C1, C2 (and `activation.ts` from C4a for the guard import — so order C4a before C3, OR
land `isActiveByName` as a trivial always-true stub in C3 and wire the real index in C4c; **chosen:
C4a precedes C3** so `price()` imports the real evaluator from the start — see ordering note).

> **Ordering note:** the activation model (C4a) has **no pricing dependency** and the price guard
> (C3/C4c) depends on it, so the program order is **C1 → C2 → C4a → C4b → C3 → C4c → C5…**. C3's
> price guard then imports the real `isActiveByName`. (Commit *numbers* keep the pricing/activation
> grouping legible; the *dependency order* is as stated.)

### C4a — `feat(forms): activeWhenEquals rule + ActiveWhen predicate + shared isActive + decode integrity`

**Files:** EDIT `app/lib/forms/definition.ts` (add `ActiveWhen` `TaggedUnion`
[`literalEquals`/`arrayIncludesAny`/`checkboxChecked`]; add `activeWhenEquals` member to
`CrossFieldRule` `:490`; add `rulesReferToExistingFields` filter covering BOTH rule kinds + the
same-scope + cycle checks, attach to `FormDefinition` `:512`). NEW `app/lib/forms/activation.ts`
(`activationIndex`, `isActiveByName`, `predicateHolds`). EDIT `app/lib/forms/decode.ts` (model
`activeWhenEquals` targets `optionalKey` at their struct entry; wire the four decode rows of
Decision 5 into the single `makePresenceFilter` accumulator `:464-478`). EDIT
`definition.test.ts` + `decode.test.ts` + NEW `activation.test.ts`.
**Gate-green:** decoder is self-contained; no price/Stripe dependency. Tests: integrity filter
rejects dangling `when`/`target`, out-of-option `equals`/`values`, wrong `when` kind, and cycles;
the four decode rows (absent/present × active/inactive) per predicate kind; `requiredWhenEquals`
integrity now also enforced (the closed pre-existing gap).
**Deps:** C2 (the `FormDefinition.check` slot is added here cleanly alongside pricing's filter —
compose both filters; see Risk on multiple struct-level checks).

### C4b — `refactor(forms): render activation gate; retire requiredWhenEquals-as-visibility`

**Files:** EDIT `app/lib/forms/render.tsx` (build an `activationGates` index in `FormFields`
mirroring the `gateRules` idiom `:309-315`, keyed by `target`, but from `activeWhenEquals` rules;
feed `RuleGatedField` `:157-176` from `isActiveByName` via a small `ActiveWhen`-aware adapter;
**stop deriving visibility from `requiredWhenEquals`** — that index now drives presence-validation
only). EDIT the contact/volunteer form definitions/defaults to express their `method`-gated
email/phone as `activeWhenEquals` (visibility) **plus** `requiredWhenEquals` (non-empty-when-shown)
— a behavior-preserving migration. EDIT `render.test.tsx`.
**Gate-green:** render-only; depends on C4a's schema + evaluator. Tests: an inactive target is not
rendered; flipping the `when` control shows it; the migrated contact/volunteer `method` gate still
hides/shows email/phone identically (existing render tests stay green); a `checkboxChecked` and an
`arrayIncludesAny` gate render correctly.
**Deps:** C4a.

### C4c — `feat(forms): price skips inactive contributions (activation × pricing orthogonality)`

**Files:** EDIT `app/lib/forms/price.ts` (`contributionOf` guarded by `isActiveByName` — already
sketched in C3; this commit makes the guard real by importing the C4a index and adds the
orthogonality tests). EDIT `price.test.ts`.
**Shape:** Decision 4/5 — `price-eligibility = isActive ∧ ∃ rule`.
**Gate-green:** depends on C3 (`price()`) + C4a (`isActiveByName`). Tests (the load-bearing ones):
a priced `activeWhenEquals` field with `when ∉ predicate` ⇒ excluded from total; `when ∈ predicate`
⇒ included; a *smuggled* present-inactive value is rejected at **decode** so `price` never sees it
(assert decode rejects, price untouched); the four orthogonality combos each priced/charged
correctly (active∧priced charges, active∧unpriced 0, inactive∧priced 0, inactive∧unpriced 0).
**Deps:** C3, C4a.

### C5 — `build(deps): add @distilled.cloud/stripe (existing effect override) + Stripe env config`

**Files:** EDIT `package.json` (add `"@distilled.cloud/stripe": "0.26.1"` to deps — **do NOT add a
second `overrides` key**; the existing top-level `"overrides": { "effect": "4.0.0-beta.60" }` at
`:58-60` already forces distilled's transitive effect to beta.60; the residual EBADPEER **warning**
is expected/benign; optionally bump `effect` to the SDK's `>=beta.66` floor instead — but that's a
separate global decision, out of scope). EDIT `app/lib/env.server.ts` (add `StripeConfig`
`{ apiKey: Redacted, webhookSecret: Redacted, currency: CurrencyCode }`; read as
`Option<StripeConfig>` via the `sendgridConfig` blank-collapse idiom `:61-78` — both secrets
non-blank ⇒ `Some`, else `None`; add `stripe: Option<StripeConfig>` to `Service` shape `:131-139`
+ both layer branches `:159-170`). EDIT/NEW env assertions.
**Gate-green:** `bun install` succeeds (override already in place); env test proves
optional-everywhere (`Some` iff both non-blank, else `None`). No Stripe call yet → typecheck only
needs the import to resolve. Commit body notes the Apache-2.0 (package.json, authoritative) vs
README-MIT discrepancy.
**Deps:** C1 (`CurrencyCode`). Parallel-safe with C2–C4 but sequenced after for a clean stack.

### C6 — `feat(payment): Payment Context.Service over distilled (createIntent + constructEvent) + typed errors`

**Files:** NEW `app/lib/payment.server.ts` (`Payment` `Context.Service` mirroring
`submissions.server.ts:68-94` house pattern; `createIntent(amount: Cents, currency: CurrencyCode,
receiptEmail: string, metadata, idempotencyKey): Effect<{intentId, clientSecret}, PaymentError | PaymentDisabled>`
(the `receiptEmail` param threads to `PostPaymentIntents.receipt_email` `:517`, Decision 2b) and
`constructEvent(rawBody, signature): Effect<StripeEvent, PaymentWebhookError | PaymentDisabled>`;
layer reads `Env.stripe`, `None` ⇒ methods fail `PaymentDisabled` mirroring `SendgridDisabled`;
`Some` ⇒ builds the distilled layer over `FetchHttpClient` + `Credentials` and runs
`PostPaymentIntents(input, { idempotencyKey })`, mapping distilled's tagged errors
[`CardError`/`InvalidRequestError`/`IdempotencyError`/`UnknownStripeError`] via `Effect.catchTags`
to one `PaymentError extends Schema.TaggedErrorClass`). NEW `app/lib/payment.server.test.ts`.
**Shape:** `amount` is raw integer minor units (the `Cents` brand guarantees integer ≥0 — no
dollar→cents helper); `idempotencyKey` is the **second arg**, never the body. `clientSecret` is
`Redacted.value()`'d once here at the boundary. `constructEvent` wraps
`Webhooks.constructEvent({ payload, signature, secret: webhookSecret })` (HMAC over raw body, 300s
tolerance, `Redacted` secret).
**Gate-green:** a `Payment.testLayer` (`Layer.succeed(Payment.Service, fake)`) proves `createIntent`
returns a fake intent with **no network**; a disabled-env layer proves `PaymentDisabled`. Typechecks
against distilled's exported operation/error types.
**Deps:** C1 (`Cents`/`CurrencyCode`), C5 (env + dep).

# Re-sliced commits

The party scope is a `FormDefinition` schema SECTION + a route-owned shell decoder + a renderer + `/admin` authoring + the email relaxation — bigger than the old C7.5. It re-slices the old C7/C7.5 into **C6.5 (NEW) + C7a (NEW) + C7 (re-cut) + C7.5 (re-cut)**. Each is gate-green standalone (`bun test` + `react-router typegen && tsgo --noEmit` + `oxlint`). The email relaxation is **split into its own commit (C7a)** per the high-blast-radius sub-commit rule (a pure data toggle, independently testable and independently valuable — it must NOT be coupled to the payer-model risk).

### C6.5 (NEW) — `feat(forms): party section schema (billingMode Record selector + nominatable payer) + integrity filter`
- **Files:** NEW `app/lib/forms/party.ts` (`BillingMode`, `BillingModeSelector` with `options: Struct({ group?: Text, perRegistrant?: Text }).check(nonEmptyOptions)`, `PayerFields` = name + email, `PartySection`). EDIT `definition.ts`: add `party: Schema.optionalKey(PartySection)` to `FormDefinition` (`:512`); fold the **`'group' ∈ options keys ⟺ payer present`** biconditional into the combined `FormDefinition.check` (the slot added in C4a — compose, don't chain, Risk 6).
- **Registration-only by CONSUMER, NOT a per-form schema guard (OQ2 resolved):** `party` is a general `optionalKey` on the shared `FormDefinition` — a `FormDefinition.check` CANNOT reject it per-form (all three forms share one schema, no `FormId` context). Enforcement is at the consumer: ONLY the registration route + `FORM_SPECS.registration` read/fan-out `party`; `<FormFields>` ignores a `party` it doesn't own; contact/volunteer never author one (a stray `party` is inert, not a payment path). Matches the `variant` precedent — no schema-level guard to write.
- **Backfill-safe:** `optionalKey` ⇒ all three `forms/*.json` decode unchanged (back-compat test — a definition with no `party` decodes). No `FORM_SPECS.normalize`.
- **Gate-green:** no consumers yet → compiles isolated. Tests: `PartySection` round-trip; the biconditional rejects `group`-without-payer and `perRegistrant`-only-with-payer; `nonEmptyOptions` requires ≥1 authored mode; a group-only `options` decodes (the allow-list case); **the two de-risk spikes already proven** in `app/lib/forms/party-scope-spike.test.ts` (the struct-of-optionalKey label edit round-trips through `deepMerge` incl. group-only; a new `registration.party.*` MessageKey token fails until registered in `translations.ts`) — graduate them into this commit's suite.
- **Deps:** C4a (the combined `FormDefinition.check` slot). Per the build order (Slice 1/2 above) C4a precedes C5/C6, so the slot exists by C6.5.

### C7a (NEW) — `feat(forms): registrant email optional-at-key + new party MessageKey tokens (authoring half)`
- **Files:** EDIT `app/lib/content/pages/defaults.ts` (flip the registration `email` field `:751-757` to `optional: true`; author `defaultRegistrationForm.party` — **group-only `options` here** per the C7-standalone fix below — payer copy referencing the new keys). EDIT `app/lib/localization/translations.ts` (register the new `registration.party.*` MessageKey **tokens** — the one deploy; their strings are thereafter CMS-editable). EDIT `decode.test.ts` (the email-kind decode-level assertions per 2b.3).
- **Scope boundary:** C7a is the **authoring + schema-level** half (optional-at-key + tokens + authored block). The **shell blank-drop normalization + the end-to-end action test** that make "group blank non-leader passes" actually work live in **C7** (they need the shell). C7a alone makes *absent* email valid; it does NOT yet make the *present-blank rendered* payload pass — that's C7. Stated so C7a is not mistaken for "relaxation done."
- **Gate-green:** data + token edit, provable in isolation. Tests: *absent* registrant email decodes valid; present-blank still rejects at the codec (the shell drop is C7); present-malformed rejects `invalidMessage`; the new `party` block round-trips; the new MessageKey tokens resolve.
- **Deps:** C6.5 (the `party` schema the authored block decodes against).

### C7 (re-cut) — `feat(payment): party-aware shell decode + group checkout (frozen payer receiptEmail) + one intent`
- **Files:** EDIT `decode.ts` (**export `email` + `requiredString`** — the named migrate-callers edit; the shell is the new caller). NEW `app/lib/forms/registration-shell.ts` (`registrationShellSchema` — the **group arm + no-party legacy arm** only: `payerCodec`, `nonEmptyParty`, the chosen-mode codec via `Schema.optionalKey(...).pipe(Schema.withDecodingDefaultKey(Effect.succeed(allowed[0])))`; **the `group`-arm blank-registrant-email drop** — normalize `registrants[i].email === '' ⇒ absent` BEFORE the per-registrant codec, so an un-filled non-leader email decodes valid, 2b.3). EDIT `registration-action.ts` (decode via `registrationShellSchema`; `group` ⇒ `priceGroup`, freeze `order.receiptEmail = decoded.party.payer.email`, one intent). EDIT `registration-form.tsx` (render the CMS-authored mode selector + payer block from `definition.party.*` `Text` above the registrants repeater; **mandatory lockstep** — add `party` to BOTH `RegistrationFormShape` `:112` AND the runtime shell, plus a **party seed** in `makeDefaultRegistrant`'s sibling; **the "I'm paying" shortcut (OQ3):** a client-side affordance in the group payer block copying a chosen registrant's name+email into the `party.payer` inputs — convenience only, server still decodes + freezes `party.payer.{name,email}`, NO schema change). Extend the render-parity sets with the `party.*` submit-names.
- **Gate-green:** group checkout end-to-end via `Payment.testLayer`; party authoring round-trips through `deepMerge` (the struct-of-optionalKey label edit lands on only `options.group.en`); group blank-payer-email fails at `party.payer.email`; **a NEW action-level test through `parseSubmission`** — a `group` submission whose non-leader registrant renders `email: ''` SUCCEEDS (proves the shell blank-drop end-to-end on the real rendered payload, not just the schema — the `--deep` BLOCKER); the "I'm paying" affordance copies a registrant's values and the decoded payer matches; empty party fails; Stripe-disabled skips.
- **Deps:** C3/C4c (`priceGroup`), C6 (`Payment`), C6.5 + C7a (party schema + optional-at-key email + tokens).

### C7.5 (re-cut) — `feat(payment): perRegistrant cardinality + per-registrant email re-imposition + allow-list + receipt fan-out`
- **Files:** EDIT `app/lib/content/pages/defaults.ts` (**author the `perRegistrant` option** onto `defaultRegistrationForm.party.billingMode.options` — C7a authored group-only; this is where the second mode becomes offered, AFTER the server branch exists, fixing the C7-standalone hazard). EDIT `registration-shell.ts` (widen to the **mode union** via `buildModeUnion`: add the `perRegistrant` arm + `requireRegistrantEmails`; keep the absent-mode default + present-off-list reject). EDIT `registration-action.ts` (branch on `decoded.party._tag`: `perRegistrant` ⇒ N orders/intents keyed `:${index}`, `receipt_email = registrants[i].email`). EDIT `registration-form.tsx` (show the selector only when ≥2 modes authored; show the payer block only when the live mode is `group`).
- **Gate-green:** allow-list (present `perRegistrant` on a group-only form rejects at decode; both accepts); absent mode on a 2-mode form decodes to the first authored arm with its requirements intact; cardinality (3 perRegistrant ⇒ 3 orders/intents/keys); receipt routing (intent_i `=== registrants[i].email`, group intent `=== payer.email`); email orthogonality (perRegistrant blank registrant email fails, group blank non-leader passes, group blank payer fails).
- **Deps:** C7.

### C8 (webhook), C9 (quantity kind + pricing CMS authoring) — unchanged
- C9's `/admin/forms/:form` editor **extends** the party authoring inputs (no new leaf-coercion: every party leaf is a string — `Text` halves, `MessageKey`, the `options` struct keys (`group`/`perRegistrant`)). The C9 leaf-coercion list (`amount`/`unit`/`base`/`delta`) is pricing's concern, not the party's. Note the dep so C9 edits rather than re-creates the route.

---

### C8 — `feat(payment): Stripe webhook route — verify → amount-check → mark order+registrants paid (idempotent)`

**Files:** NEW `app/routes/api.stripe-webhook.ts` (a top-level non-localized POST route added to
`app/routes.ts` as `route('api/stripe/webhook', 'routes/api.stripe-webhook.ts')` — sibling of
`admin/login`, outside `:lang?`). EDIT `app/routes.ts`. EDIT `app/lib/forms/submissions.server.ts`
(`markOrderPaid` flips order `paid` + each registrant submission `paid`, no-op if already paid).
The route: `const raw = await request.text()` **before any parse**; `Payment.constructEvent(raw, sig)`;
narrow `event.type === 'payment_intent.succeeded'` / `'payment_intent.payment_failed'`; decode
`event.data.object` for `id` + `metadata.orderId` + `amount`; re-read the order; **verify
`event.amount === order.amount`** before marking paid; mark `paid`/`failed`; return 200. Unverified
⇒ 400; unknown event types ⇒ 200 ignore; `Env.stripe` `None` ⇒ 503.
**Gate-green:** forged-signature body → 400; valid `succeeded` with matching amount flips order +
all registrants to `paid`; **amount-mismatch event → rejected, order stays pending**; replaying the
same event is idempotent (stays `paid`, mirrors the `c8c4abd` idempotency fix); `payment_failed` →
`failed`. WebCrypto HMAC runs in Bun with no network.
**Deps:** C6 (`constructEvent`), C7 (order record + `payment` state).

### C9 — `feat(forms): number FieldKind + quantity pricing rule + CMS pricing authoring surface`

**Files:** EDIT `app/lib/forms/definition.ts` (add `number` to `FieldKind` `TaggedUnion`
[`Schema.Int.check(isGreaterThanOrEqualTo(0))`, optional `min`/`max`] — **and the hand-written
recursive `FieldKindShape` mirror `:136-183` in lockstep** or `Schema.suspend` `:362-364` won't
typecheck). EDIT `app/lib/forms/decode.ts` (its leaf codec + `fieldToStructEntry` + `groupPresence`/
`isPresenceRequirableLeaf` arms). EDIT `app/lib/forms/render.tsx` (`<input type=number>`). EDIT
`app/lib/forms/pricing.ts` (add `quantity` `PricingRule` member). EDIT `price.ts` (`contributionOf`
quantity = `clamp(qty, 0, max) * unit`). EDIT the reference filter to require `quantity.field` is a
`number` kind. EDIT `app/lib/content/admin-form.ts` (leaf-coercion adds `amount`/`unit`/`base`/
`delta`/`min`/`max` → `Number(...)`; the `/admin/forms/:form` editor renders pricing/window/rule
inputs id-keyed so `deepMerge` handles them like FAQ/hotels). NEW `app/routes/admin/forms.$form.tsx`
+ route entry (authenticated, reuses `formScope`/`DraftEditor` — no new storage path). Tests across
each edited module.
**Gate-green:** number-kind round-trip + decode + render; quantity pricing math; admin coercion +
draft/publish/validation/cache-bust; legacy `forms/registration.json` with no pricing/rules still
decodes (`optionalKey` — **no backfill needed**, unlike a new required key; note explicitly to avoid
the recurring backfill hazard).
**Deps:** C1–C3 (pricing core), C7 (`PaymentState`), C4a (activation authoring).

---

## 3. Divergences resolved

| decision | Claude said | Codex said | **FINAL + why** |
|---|---|---|---|
| **Pricing location** | separate `PricingRules` keyed by field/option + decode-time integrity filter | inline `price` on `FieldOption` + `priceWhenTrue` on `checkboxBoolean` | **Separate `PricingRules` (Claude).** `FieldOption` is reused by the variant discriminator (`definition.ts:459`) where a price is meaningless ⇒ inline is a `make-impossible-states-unrepresentable` violation; separate + `variantsMatchOptions`-style filter is the codebase's own idiom and adds one field, not N. Keep Codex's money brands + pure shared evaluator. |
| **Payment cardinality** | per-registrant intents (C6 said `price(definition, registrant)`) | one per group, key = registrant[0]'s submission id | **Mode-dependent (Decision 2b supersedes "always group"): `group` = ONE intent for the party sum; `perRegistrant` = N intents.** Keyed off the request fingerprint + `:${mode}` (+ `:${index}` for perRegistrant), NOT a registrant submission id (unstable: `sha256(whole payload)` shifts on any edit ⇒ double-charge). Amount frozen onto the order record. |
| **`pricing` required vs optional** | `optionalKey`, absence = unpriced | required + `normalize` backfill | **`optionalKey` (Claude).** `variant`/`rules` are already `optionalKey` (`:516-517`); required makes the `normalize` hook load-bearing and breaks any decode that bypasses it. Removes the hazard instead of papering it. |
| **Conditional model** | `activeWhenEquals` as a new `CrossFieldRule` member (literal-equals only) | per-field `activeWhen` predicate union (literal/array/checkbox) on field chrome | **New `CrossFieldRule` member (Claude's home) carrying Codex's richer `ActiveWhen` predicate union.** Rule-home keeps the closed `FieldKind` + recursive mirror type untouched (`subtract-before-you-add`) and reuses the existing renderer/decoder indices; Codex's predicate union is needed for checkbox + array triggers. One shared `isActive`, three consumers; retire `requiredWhenEquals`-as-visibility. |
| **Timing window boundaries** | inclusive `[from, to]` | half-open `[from, to)` | **Half-open `[from, to)` (Codex).** Composes at boundaries with no double-counting; pair with the non-overlap decode filter so first-match is total. |
| **Feature flag** | `enabled: false` registration *page* | `REGISTRAR_CHECKOUT_ENABLED` env | **`Env.stripe` `None`-gate (the house pattern), optional `REGISTRAR_CHECKOUT_ENABLED` kill-switch.** There is no `'registration'` `PageId` and `FormDefinition` has no `enabled` field — Claude's page-flag does not exist; Codex's env flag is right but the `Env.stripe` `Some/None` collapse is the established idiom. |

### Party-scope re-design (Decision 2b — supersedes the billing-mode rows above)

| question | CLAUDE design | CODEX design | FINAL + why |
|---|---|---|---|
| **Party-scope placement** | `party?: PartySection` optionalKey sibling on `FormDefinition` | `party?: PartyScope` optionalKey sibling on `FormDefinition` | **Both agree → ADOPT.** A fifth `optionalKey` sibling of `fields`/`variant`/`rules` (`definition.ts:512-518`). Reconciles with "8 kinds, no ninth" (the closed union governs `FieldList` leaves only); backfill-safe via the `pageSpec`-confirmed `optionalKey` (`registry.ts:232`). Both reviews verified SOUND. |
| **Payer model** | Authored payer always present; instance decoded only in `group` (tagged-union shell) | `DecodedParty = group{payer} \| perRegistrant{}` tagged union; type-distinct `Payer` | **Codex's tagged DECODED union + Claude's authored/decoded split → ADOPT BOTH, with a fix.** Decoded party is a `_tag`-union (payer structurally absent in `perRegistrant`). **FIX over both:** authored `payer` is `optionalKey` + a `'group' ∈ options ⟺ payer` biconditional integrity filter (both designs left the filter dead/always-true — a representable-but-meaningless state). Payer is a fixed name+email contact, not an open field graph. |
| **Email relaxation** | Data edit (`optional:true`); arm already exists; mode-conditional at shell | Data edit (`optional:true`); arm already exists; the split makes registrant email normally-optional | **Both agree → ADOPT.** Verified: `email` kind has `optional` arm (`definition.ts:327` + `decode.ts:239-253`); registration instance omits it (`pages/defaults.ts:751-757`). The prior plan's "no optional arm" is stale. **FIX:** split into its own commit **C7a** (high-blast-radius rule); budget the render-parity + party-seed churn honestly (not a free toggle). |
| **Crux: lift activation vs imperative shell** | Imperative route-owned shell; do NOT lift | Bounded shell filter; do NOT lift the general DAG | **Both agree → ADOPT (do NOT lift).** Lifting forces an enclosing-scope arm through decode+render+integrity (all same-scope-`FieldName` today) to serve one *unauthored closed* fact — over-generalizing the riskiest module. The party→registrant email law is a same-scope sibling check in the route-owned shell. **FIX over both:** export `email`/`requiredString` from `decode.ts` (named edit), use the real `withDecodingDefaultKey` API, retain `nonEmptyParty`, specify `buildModeUnion` as a concrete local. |
| **Mode-option authoring** | array of `{value,label}`, "identity-keyed by `value`" | array of `{value,label}`, "identity-keyed by `value`" | **Both WRONG → REJECT; also reject the obvious `Record(BillingMode, Text)` (it requires ALL literal keys in beta.60, so no allow-list). Model as `Struct({ group?: Text, perRegistrant?: Text }).check(nonEmptyOptions)`** — absent key = mode not offered; value is `Text` so path is `options.group.en`; merges natively via `deepMerge`'s object branch (no `itemIdentity`). Verified in `party-scope-spike.test.ts`. |
| **CMS "no deploy" honesty** | "zero route-static labels survive… now CMS-authored" (overclaims) | "every party string CMS via deepMerge" (overclaims) | **Both overclaim → CORRECT both.** `MessageKey` *tokens* validate against the static `TRANSLATION_KEYS` (`definition.ts:52`) — new tokens ship in `translations.ts` (a deploy, in C7a); thereafter their strings AND all `Text` labels are CMS-editable. Stated honestly, not papered. |

---

## 4. Open questions for the human (genuine business/ops calls only)

1. **Price table** — attendee/exhibitor base, meal/merch surcharges, early-bird dates + deltas,
   late deltas. (Blocks authoring real `registration.json` pricing; the engine ships with
   placeholder/zero pricing until provided.)
2. **Stripe credentials** — test + live `STRIPE_API_KEY`, the webhook endpoint `STRIPE_WEBHOOK_SECRET`,
   and whether receipts are Stripe-managed or app-managed.
3. **Billing mode & party scope** — *re-designed (Decision 2b replacement):* the party
   makes a CMS-authored billing-mode choice; a **nominatable payer** (possibly a non-attendee)
   receives the group receipt; non-leader registrant email is optional in `group`. Remaining
   genuine product calls:
   - **Payer fields** — *resolved:* **name + email** (`PayerFields` keeps `nameField` + `emailField`;
     the receipt recipient is an addressable person; the name improves the order record + future
     receipt copy).
   - **Party scope generality** — *resolved:* **registration-only by CONSUMER, schema stays general**
     (one model — the `--deep` review flagged that a `FormDefinition.check` CANNOT reject `party`
     per-form: all three forms share one `FormDefinition` schema with no `FormId` context, so a check
     has nothing to branch on). So: `party` is a general `optionalKey` on `FormDefinition` (like
     `variant`), but ONLY the registration route + `FORM_SPECS.registration` consume it — the public
     `<FormFields>` renderer ignores a `party` it doesn't own, and contact/volunteer simply never
     author one (an authored `party` on them is inert, not a payment path, since only the registration
     route fans out intents). No per-form schema guard; the consumer is the boundary. (This matches
     the `variant` precedent exactly: general schema, registration-only structural use.)
   - **"I'm paying" shortcut** — *resolved: YES.* Spec into **C7**: a "I'm one of the registrants /
     I'm paying" affordance in the `group` payer block that copies a chosen registrant's name+email
     into the payer fields (client-side convenience; the server still decodes + freezes
     `party.payer.{name,email}` exactly as authored — **no schema change**, the payer is still a
     distinct decoded identity). The common family case (mum is registrant[0] AND payer) stops
     requiring re-typing.
4. **Abandonment policy** — *resolved (Q4):* `pending` orders stay until the per-form
   `pricing.registrationDeadline`, after which a future sweep marks them **`expired`** (retained,
   never deleted — feeds a follow-up-email workflow). No sweep **cron** is built for launch; the
   `expired` state + the deadline field + the queryability are. (Open: the sweep cron + email
   workflow are a deliberate later slice, not in C1–C9.)
5. **Tiered vs additive timing** — *resolved (Q5):* **additive signed deltas.** (Documented here in
   case the org later means tiered early/regular/late base prices — that would change `windowDelta`
   to a `windowBaseOverride`, a schema change.)

---

## 5. Risks

1. **Peer-dep override drift.** The existing top-level `overrides: { effect: "4.0.0-beta.60" }`
   (`package.json:58`) already forces distilled's transitive effect to beta.60; the EBADPEER
   *warning* remains (benign). A **second `overrides` key must never be added** — it would
   duplicate-key and drop the existing pin. If effect is later bumped, re-verify the SDK compiles
   (a thin compile-smoke test importing each distilled symbol we use). Alternative: bump global
   `effect` to the SDK's `>=beta.66` floor (separate decision).
2. **Raw-body webhook in RR7.** If any middleware/loader parses the body before the route reads
   `request.text()`, HMAC fails. Mitigated structurally: the webhook is a top-level route with no
   `:lang?` layout ancestor (`routes.ts` is explicit, ADR 0003), so no parent loader runs — tested
   in C8.
3. **Idempotency ↔ deterministic-id coupling.** The no-double-charge guarantee depends on the
   request fingerprint being stable across verbatim retries (it is — `sha256(payload)`,
   `registration-action.ts:125`) and changing for genuinely-new submissions. Any priced form MUST
   use the deterministic-id persist path; a hypothetical single-record priced form (fresh random id
   per submit) would re-create an intent on retry — documented as an invariant the checkout enforces.
4. **Latent submission-`payment` backfill on read-back.** Adding `payment` to the envelope is
   `optionalKey`-safe for *decode*, but any future consumer that *reads* `submission.payment` on a
   legacy object must tolerate absence (treat as `unpriced`). The future registrar index (the
   read-back consumer) doesn't exist yet, so the backfill is **latent** — wire
   `absent ⇒ { _tag: 'unpriced' }` at that read boundary when it lands (the order record is the
   live payment-status surface in the meantime).
5. **Activation same-scope-only (v1 limitation).** A `nestedGroup` inner field cannot be gated on a
   top-level discriminator (use `variant` for whole-section splits), and chained/cyclic activation
   is rejected at decode. Enclosing-scope + DAG activation are documented follow-ups
   (`registrar-context.md:170-171`).
6. **Two struct-level `.check`s on `FormDefinition`.** Pricing integrity (C2) and rule integrity
   (C4a) both attach filters to `FormDefinition` (which has none today, `:512`). Compose them as one
   accumulating filter or chain carefully — chained `.check`s **abort** after the first failure
   (Effect default), which would hide a second integrity error. Prefer one combined filter (mirrors
   the decoder's single `makePresenceFilter` rationale, `decode.ts:453-462`).
7. **Negative-total clamp is a runtime guard, not a type guarantee.** `CentsDelta` is signed; a
   window/discount more negative than `base + choices` is representable and only caught by
   `Math.max(0, …)` in `price()`. Acknowledged — the clamp is the guard, the brand isn't.

---

**File references used (full paths):**
`docs/registrar-context.md`;
`app/lib/forms/definition.ts:104,119,136-183,312-367,402-432,440-463,469-498,512-519`;
`app/lib/forms/decode.ts:57,104-108,135-170,179-204,212-255,313-376,439-478,495-523`;
`app/lib/forms/submission.ts:63-101`;
`app/lib/forms/submissions.server.ts:68-94,108-153,161-164`;
`app/lib/forms/registration-action.ts:95-148`;
`app/lib/forms/render.tsx:130-176,191-231,233-315`;
`app/lib/env.server.ts:53-78,131-174`;
`app/lib/content/pages/registry.ts:74-98,128-129,150-164,229-239`;
`app/lib/content.server.ts:576-607`;
`app/lib/content/draft-editor.server.ts:369-379`;
`app/lib/content/schema.ts:220-352,373`;
`app/lib/content/home-photo-backfill.ts` (backfill prior art via `registry.ts:212-217`);
`app/lib/effect/runtime.ts:23-29,84-101,146-189`;
`app/routes.ts:24-58`;
`package.json:9-15,21,28,58-60`;
distilled SDK `@distilled.cloud/stripe@0.26.1` (Apache-2.0):
`src/operations/PostPaymentIntents.ts`, `src/webhooks.ts`, `src/credentials.ts`, `src/errors.ts`.
